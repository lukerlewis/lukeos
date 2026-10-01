import "server-only";
import { eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { db, schema } from "@/db";

/**
 * Phone and computer notifications (Web Push). Each device that says yes to
 * notifications is saved; sending goes through Apple's, Google's or
 * Mozilla's own free push service for that device.
 *
 * The signing keys (VAPID) are made the first time they're needed and kept in
 * app settings, so there's nothing to set up on the host.
 */

const { appSettings, pushSubscriptions } = schema;
const KEYS = "vapid_keys";

type Keys = { publicKey: string; privateKey: string };

let cached: Keys | undefined;

async function vapidKeys(): Promise<Keys> {
  if (cached) return cached;
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEYS)).limit(1);
  if (row) return (cached = JSON.parse(row.value) as Keys);
  const fresh = webpush.generateVAPIDKeys();
  // If two requests race, the first one saved wins and both use it.
  await db.insert(appSettings).values({ key: KEYS, value: JSON.stringify(fresh) }).onConflictDoNothing();
  const [saved] = await db.select().from(appSettings).where(eq(appSettings.key, KEYS)).limit(1);
  return (cached = JSON.parse(saved.value) as Keys);
}

/** The public half, which a browser needs to sign up for notifications. */
export async function vapidPublicKey() {
  return (await vapidKeys()).publicKey;
}

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

export async function savePushSubscription(sub: PushSubscriptionInput, deviceName: string) {
  await db
    .insert(pushSubscriptions)
    .values({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, deviceName })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: sub.keys.p256dh, auth: sub.keys.auth, deviceName },
    });
}

export async function removePushSubscription(endpoint: string) {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function pushDeviceCount() {
  return (await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions)).length;
}

export type PushMessage = {
  title: string;
  body: string;
  /** Where tapping the notification opens. */
  url: string;
  /** The number shown on the app icon. */
  badge?: number;
  /** Notifications with the same tag replace each other rather than pile up. */
  tag?: string;
};

/** Sends a notification to every device that has said yes. Never throws. Returns how many it reached. */
export async function sendPush(message: PushMessage) {
  try {
    const subs = await db.select().from(pushSubscriptions);
    if (subs.length === 0) return 0;
    const keys = await vapidKeys();
    const options = {
      vapidDetails: { subject: vapidSubject(), publicKey: keys.publicKey, privateKey: keys.privateKey },
      TTL: 24 * 3600,
      urgency: "high" as const,
    };
    const payload = JSON.stringify(message);
    const gone: string[] = [];
    let reached = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, options);
          reached++;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          // The device turned notifications off or the app was removed.
          if (status === 404 || status === 410) gone.push(s.id);
          else console.error("[push] couldn't send to", s.deviceName, status, (err as Error).message);
        }
      }),
    );
    if (gone.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
    if (reached) await db.update(pushSubscriptions).set({ lastSentAt: new Date() });
    return reached;
  } catch (err) {
    console.error("[push] failed", err);
    return 0;
  }
}

/** Push services want a way to reach whoever runs the app: the app's own address. */
function vapidSubject() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : "https://lukeos-kappa.vercel.app";
}
