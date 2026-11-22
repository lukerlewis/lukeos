import "server-only";
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect } from "node:http2";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PushMessage } from "./push";

/**
 * Notifications for the LukeOS iPhone app, sent through Apple's push service.
 * (Browsers and the Home Screen web app use Web Push instead; see push.ts.)
 *
 * Apple wants each send signed with a key from Luke's developer account. He adds
 * it once in Settings and it's kept in app settings, like the Web Push keys, so
 * there's nothing to set up on the host.
 */

const { appSettings, apnsDevices } = schema;
const KEY = "apns_key";
/** The iPhone app's bundle id, which is what Apple files its notifications under. */
const DEFAULT_TOPIC = "com.lewisdesign.lukeos";
const DEFAULT_TEAM = "563YN34NMT";

export const apnsEnvironments = ["sandbox", "production"] as const;
export type ApnsEnvironment = (typeof apnsEnvironments)[number];

type ApnsKey = { keyId: string; teamId: string; p8: string; topic: string };

async function apnsKey(): Promise<ApnsKey | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as ApnsKey;
  } catch {
    return null;
  }
}

/** Whether Luke has added his Apple key yet, and which one (never the key itself). */
export async function apnsKeyInfo() {
  const key = await apnsKey();
  return key ? { keyId: key.keyId, teamId: key.teamId } : null;
}

function readKey(p8: string): KeyObject {
  return createPrivateKey({ key: p8.includes("BEGIN") ? p8 : `-----BEGIN PRIVATE KEY-----\n${p8.trim()}\n-----END PRIVATE KEY-----\n`, format: "pem" });
}

/** Keeps the key from Luke's developer account. Throws if the file isn't a key Apple would have made. */
export async function saveApnsKey(input: { keyId: string; p8: string; teamId?: string }) {
  const p8 = input.p8.trim();
  const key = readKey(p8);
  if (key.asymmetricKeyType !== "ec") throw new Error("That isn't an Apple push key.");
  const value = JSON.stringify({ keyId: input.keyId.trim(), teamId: input.teamId?.trim() || DEFAULT_TEAM, p8, topic: DEFAULT_TOPIC } satisfies ApnsKey);
  await db.insert(appSettings).values({ key: KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
  signed = undefined;
}

export async function saveApnsDevice(token: string, deviceName: string, environment: ApnsEnvironment) {
  await db
    .insert(apnsDevices)
    .values({ token, deviceName, environment })
    .onConflictDoUpdate({ target: apnsDevices.token, set: { deviceName, environment } });
}

export async function removeApnsDevice(token: string) {
  await db.delete(apnsDevices).where(eq(apnsDevices.token, token));
}

export async function apnsDeviceCount() {
  return (await db.select({ id: apnsDevices.id }).from(apnsDevices)).length;
}

const b64 = (data: string | Buffer) => Buffer.from(data).toString("base64url");

// Apple wants the same signed pass reused for a while (it rejects a new one every send), and a fresh one within the hour.
let signed: { jwt: string; at: number; keyId: string } | undefined;

function providerToken(key: ApnsKey) {
  const now = Math.floor(Date.now() / 1000);
  if (signed && signed.keyId === key.keyId && now - signed.at < 45 * 60) return signed.jwt;
  const head = `${b64(JSON.stringify({ alg: "ES256", kid: key.keyId }))}.${b64(JSON.stringify({ iss: key.teamId, iat: now }))}`;
  const signature = sign("sha256", Buffer.from(head), { key: readKey(key.p8), dsaEncoding: "ieee-p1363" });
  signed = { jwt: `${head}.${b64(signature)}`, at: now, keyId: key.keyId };
  return signed.jwt;
}

const hosts: Record<ApnsEnvironment, string> = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
};

type Sent = { status: number; reason: string | null };

/** Sends one notification to each of these phones over a single connection to Apple. */
function sendTo(environment: ApnsEnvironment, tokens: string[], key: ApnsKey, message: PushMessage): Promise<Map<string, Sent>> {
  return new Promise((resolve) => {
    const out = new Map<string, Sent>();
    // APNS_HOST is only for trying this out against a stand-in server.
    const client = connect(process.env.APNS_HOST ?? hosts[environment]);
    let left = tokens.length;
    const done = () => {
      if (--left > 0) return;
      client.close();
      resolve(out);
    };
    const fail = () => {
      for (const t of tokens) if (!out.has(t)) out.set(t, { status: 0, reason: "NoConnection" });
      client.destroy();
      resolve(out);
    };
    client.on("error", fail);
    client.setTimeout(10_000, fail);
    const body = JSON.stringify({
      aps: {
        alert: { title: message.title, body: message.body },
        sound: "default",
        ...(message.badge !== undefined && { badge: message.badge }),
        ...(message.tag && { "thread-id": message.tag }),
      },
      // Where tapping it opens, in the same form as the web app's addresses ("/messages", "/?task=<id>").
      url: message.url,
    });
    for (const token of tokens) {
      const req = client.request({
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${providerToken(key)}`,
        "apns-topic": key.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": String(Math.floor(Date.now() / 1000) + 24 * 3600),
        // Notifications with the same tag replace each other rather than pile up.
        ...(message.tag && { "apns-collapse-id": message.tag.slice(0, 64) }),
        "content-type": "application/json",
      });
      let status = 0;
      let text = "";
      req.on("response", (headers) => (status = Number(headers[":status"])));
      req.setEncoding("utf8");
      req.on("data", (chunk) => (text += chunk));
      req.on("end", () => {
        let reason: string | null = null;
        try {
          reason = text ? ((JSON.parse(text) as { reason?: string }).reason ?? null) : null;
        } catch {}
        out.set(token, { status, reason });
        done();
      });
      req.on("error", () => {
        out.set(token, { status: 0, reason: "RequestFailed" });
        done();
      });
      req.end(body);
    }
  });
}

/** Sends a notification to every iPhone with the app that has said yes. Never throws. Returns how many it reached. */
export async function sendApns(message: PushMessage) {
  try {
    const devices = await db.select().from(apnsDevices);
    if (devices.length === 0) return 0;
    const key = await apnsKey();
    if (!key) return 0;
    const gone: string[] = [];
    const reached: string[] = [];
    for (const environment of apnsEnvironments) {
      const mine = devices.filter((d) => d.environment === environment);
      if (mine.length === 0) continue;
      const results = await sendTo(environment, mine.map((d) => d.token), key, message);
      // A token Apple doesn't know here may belong to its other service (the app was reinstalled another way).
      const other = environment === "sandbox" ? "production" : "sandbox";
      const retry = mine.filter((d) => results.get(d.token)?.reason === "BadDeviceToken");
      const second = retry.length ? await sendTo(other, retry.map((d) => d.token), key, message) : new Map<string, Sent>();
      for (const d of mine) {
        const first = results.get(d.token);
        const again = second.get(d.token);
        if (first?.status === 200) reached.push(d.id);
        else if (again?.status === 200) {
          reached.push(d.id);
          await db.update(apnsDevices).set({ environment: other }).where(eq(apnsDevices.id, d.id));
        } else if (first?.status === 410 || first?.reason === "Unregistered" || (first?.reason === "BadDeviceToken" && again?.reason === "BadDeviceToken")) {
          // The app was removed, or notifications were turned off for good.
          gone.push(d.id);
        } else console.error("[apns] couldn't send to", d.deviceName, first?.status, first?.reason, again?.status, again?.reason);
      }
    }
    if (gone.length) await db.delete(apnsDevices).where(inArray(apnsDevices.id, gone));
    if (reached.length) await db.update(apnsDevices).set({ lastSentAt: new Date() }).where(inArray(apnsDevices.id, reached));
    return reached.length;
  } catch (err) {
    console.error("[apns] failed", err);
    return 0;
  }
}
