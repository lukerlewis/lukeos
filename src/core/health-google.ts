import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDays, momentIn, timeIn, todayIn } from "@/lib/dates";
import { emptySummary, type HealthSummary, type HealthWorkout } from "@/lib/health";
import { getTimeZone } from "./settings";

/**
 * Luke's Fitbit, read through the Google Health API (the old Fitbit API was switched off
 * on 2 Nov 2026). He makes his own Google Cloud project, pastes its client ID and secret
 * into LukeOS once, then signs in with Google. Everything is kept in app settings, so
 * there's nothing to set up on the host.
 *
 * Data comes in three ways: once a day (Vercel cron), whenever Google says something
 * changed (webhook), and when the Health page or Claude asks for a fresh copy.
 */

// The overrides are for testing against a stand-in Google on a laptop.
const API = process.env.GOOGLE_HEALTH_API_BASE ?? "https://health.googleapis.com/v4";
const AUTH_URL = process.env.GOOGLE_OAUTH_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.GOOGLE_OAUTH_TOKEN_URL ?? "https://oauth2.googleapis.com/token";

export const HEALTH_SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  // Only to tell Google where to send "something changed" notices (Luke owns the project).
  "https://www.googleapis.com/auth/cloud-platform",
];

/** The types Google is asked to send change notices for. */
const WEBHOOK_TYPES = [
  "steps",
  "distance",
  "active-zone-minutes",
  "sleep",
  "exercise",
  "daily-resting-heart-rate",
  "daily-heart-rate-variability",
  "daily-respiratory-rate",
  "daily-oxygen-saturation",
  "daily-sleep-temperature-derivations",
];

const CLIENT_KEY = "health_google_client";
const TOKENS_KEY = "health_google_tokens";
const STATE_KEY = "health_status";

type Client = { clientId: string; clientSecret: string };
/**
 * Google Health refuses a token that also carries cloud-platform, so each kind of call gets its own
 * narrower token from the one refresh token: `accessToken` for health data, `cloud` for the webhook setup.
 */
type Tokens = {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  scope: string;
  connectedAt: string;
  cloud?: { accessToken: string; expiresAt: number };
  /** Set once `accessToken` has been narrowed to the health scopes (older saved tokens weren't). */
  healthOnly?: boolean;
};
type TokenKind = "health" | "cloud";
const DATA_SCOPES = HEALTH_SCOPES.filter((s) => s.includes("googlehealth"));
const CLOUD_SCOPES = HEALTH_SCOPES.filter((s) => !s.includes("googlehealth"));
type Status = {
  lastSyncAt?: string | null;
  /** The last thing that went wrong, in plain words, or null. */
  lastError?: string | null;
  /** Types that failed on the last sync (the rest still came in). */
  failedTypes?: string[];
  oauthState?: string | null;
  webhookSecret?: string | null;
  webhook?: { registered: boolean; error: string | null; at: string } | null;
};

export class HealthError extends Error {}

/* ---------- Settings ---------- */

async function read<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).limit(1);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

async function write(key: string, value: unknown) {
  const text = JSON.stringify(value);
  await db
    .insert(schema.appSettings)
    .values({ key, value: text })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: text } });
}

async function remove(key: string) {
  await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key));
}

async function updateStatus(changes: Partial<Status>) {
  const current = (await read<Status>(STATE_KEY)) ?? {};
  await write(STATE_KEY, { ...current, ...changes });
}

/** What the Health page needs to know about the connection (never the secrets). */
export async function healthStatus() {
  const [client, tokens, status] = await Promise.all([read<Client>(CLIENT_KEY), read<Tokens>(TOKENS_KEY), read<Status>(STATE_KEY)]);
  return {
    configured: Boolean(client),
    connected: Boolean(tokens),
    connectedAt: tokens?.connectedAt ?? null,
    lastSyncAt: status?.lastSyncAt ?? null,
    lastError: status?.lastError ?? null,
    failedTypes: status?.failedTypes ?? [],
    liveUpdates: status?.webhook?.registered ?? false,
    liveUpdatesError: status?.webhook?.error ?? null,
  };
}

/** Saves the client ID and secret from Luke's Google Cloud project. */
export async function saveClient(input: { clientId: string; clientSecret: string }) {
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) throw new HealthError("That doesn't look like a Google client ID. It ends in .apps.googleusercontent.com.");
  if (clientSecret.length < 10) throw new HealthError("That doesn't look like a client secret.");
  await write(CLIENT_KEY, { clientId, clientSecret } satisfies Client);
}

/** Forgets the Google sign-in (keeps the client ID and the numbers already saved). */
export async function disconnect() {
  const tokens = await read<Tokens>(TOKENS_KEY);
  await remove(TOKENS_KEY);
  await updateStatus({ webhook: null, lastError: null, failedTypes: [] });
  if (tokens) {
    // Tell Google too, so the sign-in shows as removed in Luke's Google account.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.refreshToken)}`, { method: "POST" }).catch(() => {});
  }
}

/* ---------- Sign-in ---------- */

export const redirectUri = (origin: string) => `${origin}/api/health/callback`;

export async function authorizeUrl(origin: string) {
  const client = await read<Client>(CLIENT_KEY);
  if (!client) throw new HealthError("Add the Google client ID and secret first.");
  const state = randomBytes(24).toString("base64url");
  await updateStatus({ oauthState: state });
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: HEALTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return url.toString();
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Google sent Luke back with a code: swap it for tokens, then fetch his last 90 days. */
export async function finishAuthorize(origin: string, code: string, state: string) {
  const [client, status] = await Promise.all([read<Client>(CLIENT_KEY), read<Status>(STATE_KEY)]);
  if (!client) throw new HealthError("Add the Google client ID and secret first.");
  if (!status?.oauthState || !same(status.oauthState, state)) throw new HealthError("That sign-in link was old. Try Connect again.");
  await updateStatus({ oauthState: null });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new HealthError(`Google didn't accept the sign-in: ${body.error_description ?? res.status}.`);
  if (!body.refresh_token) throw new HealthError("Google didn't send a lasting sign-in. Remove LukeOS from your Google account's connected apps, then Connect again.");
  await write(TOKENS_KEY, {
    refreshToken: body.refresh_token,
    // This first token carries every scope, which Google Health refuses; the health token comes from the next refresh.
    accessToken: "",
    expiresAt: 0,
    scope: body.scope ?? "",
    connectedAt: new Date().toISOString(),
    cloud: { accessToken: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 },
  } satisfies Tokens);

  // A Fitbit account has to be linked to Google Health before any data shows up.
  const identity = await api("GET", "/users/me/identity").catch((err: Error) => err);
  if (identity instanceof Error) {
    await updateStatus({ lastError: /ACCOUNT_NOT_LINKED/.test(identity.message) ? "Open the Google Health app and finish linking your Fitbit, then Connect again." : identity.message });
    return;
  }
  await registerWebhook(origin).catch(() => {});
  await syncHealth({ days: 90 });
}

async function accessToken(kind: TokenKind): Promise<string> {
  const tokens = await read<Tokens>(TOKENS_KEY);
  if (!tokens) throw new HealthError("Fitbit isn't connected.");
  const current = kind === "health" ? (tokens.healthOnly ? tokens : null) : tokens.cloud;
  if (current && current.expiresAt - Date.now() > 60_000) return current.accessToken;
  const client = await read<Client>(CLIENT_KEY);
  if (!client) throw new HealthError("The Google client ID is missing.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
      scope: (kind === "health" ? DATA_SCOPES : CLOUD_SCOPES).join(" "),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) {
    if (body.error === "invalid_grant") {
      // Google ended the sign-in (Testing mode stops it after 7 days, or Luke removed access).
      await remove(TOKENS_KEY);
      await updateStatus({ lastError: "Google ended the Fitbit sign-in. Connect again." });
      throw new HealthError("Google ended the Fitbit sign-in. Connect again.");
    }
    throw new HealthError(`Couldn't refresh the Google sign-in (${body.error ?? res.status}).`);
  }
  const fresh = { accessToken: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  await write(TOKENS_KEY, kind === "health" ? { ...tokens, ...fresh, healthOnly: true } : { ...tokens, cloud: fresh });
  return body.access_token;
}

/* ---------- Calling Google ---------- */

async function api<T = unknown>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, attempt = 0): Promise<T> {
  const token = await accessToken(path.startsWith("/projects/") ? "cloud" : "health");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 2) {
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt + Math.random() * 300));
    return api(method, path, body, attempt + 1);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
  if (!res.ok) throw new HealthError(`${json.error?.status ?? res.status}: ${json.error?.message ?? "Google Health didn't answer."}`);
  return json;
}

type GDate = { year: number; month: number; day: number };
type CivilDateTime = { date?: GDate; time?: Record<string, number> };
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: GDate | undefined) => (d ? `${d.year}-${pad(d.month)}-${pad(d.day)}` : null);
const toGDate = (day: string): GDate => {
  const [year, month, day_] = day.split("-").map(Number);
  return { year, month, day: day_ };
};
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
/** "1234s" or "1234.5s" → seconds. */
const seconds = (v: unknown) => (typeof v === "string" && /^[\d.]+s$/.test(v) ? Number(v.slice(0, -1)) : null);

/** Every data point of a type whose filter matches, all pages. */
async function listPoints(dataType: string, filter: string, pageSize: number, maxPages = 40) {
  const points: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ pageSize: String(pageSize) });
    if (filter) q.set("filter", filter);
    if (pageToken) q.set("pageToken", pageToken);
    const res = await api<{ dataPoints?: Record<string, unknown>[]; nextPageToken?: string }>("GET", `/users/me/dataTypes/${dataType}/dataPoints?${q}`);
    points.push(...(res.dataPoints ?? []));
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return points;
}

/** Daily totals of a type for [first, end), in windows of at most `chunk` days. */
async function dailyRollUp(dataType: string, first: string, end: string, chunk: number) {
  const points: Record<string, unknown>[] = [];
  for (let from = first; from < end; from = addDays(from, chunk)) {
    const to = addDays(from, chunk) < end ? addDays(from, chunk) : end;
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await api<{ rollupDataPoints?: Record<string, unknown>[]; nextPageToken?: string }>("POST", `/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`, {
        range: { start: { date: toGDate(from) }, end: { date: toGDate(to) } },
        windowSizeDays: 1,
        ...(pageToken ? { pageToken } : {}),
      });
      points.push(...(res.rollupDataPoints ?? []));
      pageToken = res.nextPageToken;
      if (!pageToken) break;
    }
  }
  return points;
}

/* ---------- Turning Google's data into days ---------- */

type Point = Record<string, unknown>;
type Source = {
  /** Google's data type, also the key in a day's raw data. */
  type: string;
  fetch: (first: string, end: string) => Promise<Point[]>;
  /** The day a data point counts towards. */
  dayOf: (p: Point) => string | null;
  /** Sets this type's numbers on a day from its points (none: the numbers go back to null). */
  apply: (s: HealthSummary, points: Point[]) => void;
};

const field = (p: Point, key: string) => (p[key] ?? {}) as Record<string, unknown>;
/** A session's local date and hour at its start or end. Google leaves out the civil times for Fitbit sessions, so this uses the UTC offset. */
const localAt = (interval: Record<string, unknown>, which: "start" | "end") => {
  const civil = interval[which === "start" ? "civilStartTime" : "civilEndTime"] as CivilDateTime | undefined;
  if (civil?.date) return { date: ymd(civil.date)!, hour: Number(civil.time?.hours ?? 0) };
  const at = Date.parse(String(interval[`${which}Time`] ?? ""));
  if (!Number.isFinite(at)) return null;
  const offset = String(interval[`${which}UtcOffset`] ?? "");
  const local = new Date(at + (/^-?[\d.]+s$/.test(offset) ? Number(offset.slice(0, -1)) : 0) * 1000);
  return { date: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
};
/**
 * The sessions that make up the night ending on a day: everything that ended before 2 PM (Fitbit often splits a night in two,
 * calling the second part a nap). An afternoon nap only counts when there was no night at all.
 */
function nightOf(sleeps: Record<string, unknown>[]) {
  const overnight = sleeps.filter((x) => (localAt(field(x, "interval"), "end")?.hour ?? 0) < 14);
  if (overnight.length) return overnight.sort((a, b) => String(field(a, "interval").startTime).localeCompare(String(field(b, "interval").startTime)));
  const asleep = (x: Record<string, unknown>) => num(field(x, "summary").minutesAsleep) ?? 0;
  const longest = [...sleeps].sort((a, b) => asleep(b) - asleep(a))[0];
  return longest ? [longest] : [];
}
const rollupDay = (p: Point) => ymd((p.civilStartTime as CivilDateTime | undefined)?.date);
const sumOf = (points: Point[], pick: (p: Point) => number | null) => {
  const values = points.map(pick).filter((v): v is number => v !== null);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
};

/** A daily type (one value per day, filtered by its date), e.g. resting heart rate. */
function daily(type: string, key: string, value: (v: Record<string, unknown>) => number | null, set: (s: HealthSummary, v: number | null) => void): Source {
  const filterName = type.replace(/-/g, "_");
  return {
    type,
    fetch: (first, end) => listPoints(type, `${filterName}.date >= "${first}" AND ${filterName}.date < "${end}"`, 1000),
    dayOf: (p) => ymd(field(p, key).date as GDate | undefined),
    apply: (s, points) => {
      const values = points.map((p) => value(field(p, key))).filter((v): v is number => v !== null);
      set(s, values.length ? values[0] : null);
    },
  };
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

const sources: Source[] = [
  {
    type: "steps",
    fetch: (first, end) => dailyRollUp("steps", first, end, 90),
    dayOf: rollupDay,
    apply: (s, points) => void (s.steps = sumOf(points, (p) => num(field(p, "steps").countSum))),
  },
  {
    type: "distance",
    fetch: (first, end) => dailyRollUp("distance", first, end, 90),
    dayOf: rollupDay,
    apply: (s, points) => {
      const mm = sumOf(points, (p) => num(field(p, "distance").millimetersSum));
      s.distanceMeters = mm === null ? null : Math.round(mm / 1000);
    },
  },
  {
    type: "active-zone-minutes",
    fetch: (first, end) => dailyRollUp("active-zone-minutes", first, end, 90),
    dayOf: rollupDay,
    apply: (s, points) =>
      void (s.activeMinutes = sumOf(points, (p) => {
        const v = field(p, "activeZoneMinutes");
        const parts = [v.sumInFatBurnHeartZone, v.sumInCardioHeartZone, v.sumInPeakHeartZone].map(num);
        return parts.every((x) => x === null) ? null : parts.reduce<number>((a, b) => a + (b ?? 0), 0);
      })),
  },
  {
    type: "total-calories",
    fetch: (first, end) => dailyRollUp("total-calories", first, end, 14),
    dayOf: rollupDay,
    apply: (s, points) => {
      const kcal = sumOf(points, (p) => num(field(p, "totalCalories").kcalSum));
      s.caloriesOut = kcal === null ? null : Math.round(kcal);
    },
  },
  daily("daily-resting-heart-rate", "dailyRestingHeartRate", (v) => num(v.beatsPerMinute), (s, v) => (s.restingHeartRate = v)),
  daily("daily-heart-rate-variability", "dailyHeartRateVariability", (v) => num(v.averageHeartRateVariabilityMilliseconds), (s, v) => (s.hrvMs = round1(v))),
  daily("daily-respiratory-rate", "dailyRespiratoryRate", (v) => num(v.breathsPerMinute), (s, v) => (s.breathingRate = round1(v))),
  daily("daily-oxygen-saturation", "dailyOxygenSaturation", (v) => num(v.averagePercentage), (s, v) => (s.spo2 = round1(v))),
  daily(
    "daily-sleep-temperature-derivations",
    "dailySleepTemperatureDerivations",
    (v) => {
      const nightly = num(v.nightlyTemperatureCelsius);
      const baseline = num(v.baselineTemperatureCelsius);
      return nightly === null || baseline === null ? null : Math.round((nightly - baseline) * 100) / 100;
    },
    (s, v) => (s.skinTempDeviation = v),
  ),
  daily("daily-vo2-max", "dailyVo2Max", (v) => num(v.vo2Max), (s, v) => (s.vo2Max = round1(v))),
  {
    type: "sleep",
    // Sleep can only be filtered by when it ended; a night counts towards the morning he woke up.
    // The civil-time filter came back empty for Luke's account, so this asks by UTC with a day to spare each side.
    fetch: async (first, end) => {
      const found = await listPoints("sleep", `sleep.interval.end_time >= "${addDays(first, -1)}T00:00:00Z" AND sleep.interval.end_time < "${addDays(end, 1)}T00:00:00Z"`, 25);
      // Filtered asks came back empty for Luke's account; the newest nights unfiltered (newest first) as a fallback.
      return found.length ? found : listPoints("sleep", "", 25, 4);
    },
    dayOf: (p) => localAt(field(field(p, "sleep"), "interval"), "end")?.date ?? null,
    apply: (s, points) => {
      const night = nightOf(points.map((p) => field(p, "sleep")));
      if (!night.length) return void (s.sleep = null);
      const stages = new Map<string, number>();
      let minutes = 0;
      let awake = 0;
      for (const x of night) {
        const summary = field(x, "summary");
        minutes += num(summary.minutesAsleep) ?? 0;
        for (const st of (summary.stagesSummary ?? []) as { type?: string; minutes?: string }[]) if (st.type) stages.set(st.type, (stages.get(st.type) ?? 0) + (num(st.minutes) ?? 0));
        awake += num(summary.minutesAwake) ?? 0;
      }
      const staged = night.every((x) => x.type === "STAGES");
      s.sleep = {
        minutes,
        start: String(field(night[0], "interval").startTime ?? ""),
        end: String(field(night.at(-1)!, "interval").endTime ?? ""),
        deepMinutes: staged ? (stages.get("DEEP") ?? 0) : null,
        lightMinutes: staged ? (stages.get("LIGHT") ?? 0) : null,
        remMinutes: staged ? (stages.get("REM") ?? 0) : null,
        awakeMinutes: awake || (stages.get("AWAKE") ?? null),
      };
    },
  },
  {
    type: "exercise",
    fetch: (first, end) => listPoints("exercise", `exercise.interval.civil_start_time >= "${first}" AND exercise.interval.civil_start_time < "${end}"`, 25),
    dayOf: (p) => localAt(field(field(p, "exercise"), "interval"), "start")?.date ?? null,
    apply: (s, points) => {
      s.workouts = points
        .map((p): HealthWorkout => {
          const e = field(p, "exercise");
          const interval = field(e, "interval");
          const metrics = field(e, "metricsSummary");
          const start = String(interval.startTime ?? "");
          const span = (Date.parse(String(interval.endTime ?? "")) - Date.parse(start)) / 1000;
          const secs = seconds(e.activeDuration) ?? (Number.isFinite(span) ? span : 0);
          const mm = num(metrics.distanceMillimeters);
          const kcal = num(metrics.caloriesKcal);
          return {
            type: String(e.exerciseType ?? "WORKOUT"),
            name: typeof e.displayName === "string" && e.displayName ? e.displayName : null,
            minutes: Math.round(secs / 60),
            startedAt: start,
            calories: kcal === null ? null : Math.round(kcal),
            distanceMeters: mm ? Math.round(mm / 1000) : null,
          };
        })
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    },
  },
];

/* ---------- Sync ---------- */

let running: Promise<unknown> | null = null;

/**
 * Fetches the last `days` days (today included, in Luke's time zone) and saves them.
 * A type that fails keeps the numbers already saved for it; the others still come in.
 */
export async function syncHealth({ days }: { days: number }) {
  if (running) await running.catch(() => {});
  const work = doSync(days);
  running = work;
  try {
    return await work;
  } finally {
    if (running === work) running = null;
  }
}

async function doSync(days: number) {
  if (!(await read<Tokens>(TOKENS_KEY))) throw new HealthError("Fitbit isn't connected.");
  const before = await read<Status>(STATE_KEY);
  // The first sync after connecting brings in the last 90 days.
  if (!before?.lastSyncAt) days = Math.max(days, 90);
  // Live updates never set up (e.g. the first sign-in stopped early): try once more.
  const site = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!before?.webhook && site) await registerWebhook(`https://${site}`).catch(() => {});
  const today = todayIn(await getTimeZone());
  const first = addDays(today, -(days - 1));
  const end = addDays(today, 1);

  const results = await Promise.all(
    sources.map(async (src) => {
      try {
        return { src, points: await src.fetch(first, end), error: null };
      } catch (err) {
        if (err instanceof HealthError && /ended the Fitbit sign-in/.test(err.message)) throw err;
        return { src, points: [] as Point[], error: `${src.type}: ${(err as Error).message}` };
      }
    }),
  );
  const ok = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  if (ok.length === 0) {
    const lastError = failed[0]?.error ?? "Nothing came back from Google Health.";
    await updateStatus({ lastError, failedTypes: failed.map((r) => r.src.type) });
    throw new HealthError(lastError);
  }

  const existing = await db
    .select()
    .from(schema.healthDays)
    .where(and(gte(schema.healthDays.date, first), lte(schema.healthDays.date, today)));
  const byDate = new Map(existing.map((r) => [r.date, { summary: { ...emptySummary(), ...r.summary }, raw: { ...r.raw } }]));

  for (let date = first; date <= today; date = addDays(date, 1)) {
    if (!byDate.has(date)) byDate.set(date, { summary: emptySummary(), raw: {} });
  }
  for (const { src, points } of ok) {
    const grouped = new Map<string, Point[]>();
    for (const p of points) {
      const day = src.dayOf(p);
      if (day && byDate.has(day)) grouped.set(day, [...(grouped.get(day) ?? []), p]);
    }
    for (const [date, row] of byDate) {
      const mine = grouped.get(date) ?? [];
      src.apply(row.summary, mine);
      if (mine.length) row.raw[src.type] = mine;
      else delete row.raw[src.type];
    }
  }

  const rows = [...byDate].map(([date, { summary, raw }]) => ({ date, summary, raw, updatedAt: new Date() }));
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    await db
      .insert(schema.healthDays)
      .values(batch)
      .onConflictDoUpdate({
        target: schema.healthDays.date,
        set: { summary: sqlExcluded("summary"), raw: sqlExcluded("raw"), updatedAt: sqlExcluded("updated_at") },
      });
  }

  const lastSyncAt = new Date().toISOString();
  // A type or two missing (say, VO2 max not measured yet) is shown under Fitbit, not as an error.
  await updateStatus({ lastSyncAt, lastError: null, failedTypes: failed.map((r) => r.src.type) });
  return { synced: true, lastSyncAt, days: rows.length, failedTypes: failed.map((r) => r.src.type) };
}

const sqlExcluded = (column: string) => sql.raw(`excluded."${column}"`);

/* ---------- "Something changed" notices from Google ---------- */

/** Asks Google to POST to /api/health/webhook whenever new Fitbit data lands. Best effort. */
export async function registerWebhook(origin: string) {
  const client = await read<Client>(CLIENT_KEY);
  const projectNumber = client?.clientId.match(/^(\d+)-/)?.[1];
  const at = new Date().toISOString();
  if (!projectNumber) return updateStatus({ webhook: { registered: false, error: "Couldn't tell the project number from the client ID.", at } });
  if (!origin.startsWith("https://")) return updateStatus({ webhook: { registered: false, error: "Live updates need the https address.", at } });
  const secret = randomBytes(32).toString("base64url");
  // Saved first: Google checks the endpoint while the subscriber is being created.
  await updateStatus({ webhookSecret: secret });
  const payload = {
    endpointUri: `${origin}/api/health/webhook`,
    endpointAuthorization: { secret: `Bearer ${secret}` },
    subscriberConfigs: [{ dataTypes: WEBHOOK_TYPES, subscriptionCreatePolicy: "AUTOMATIC" }],
  };
  const base = `/projects/${projectNumber}/subscribers`;
  try {
    await api("POST", `${base}?subscriberId=lukeos-health`, payload).catch(async (err: Error) => {
      if (!/ALREADY_EXISTS|409/.test(err.message)) throw err;
      await api("PATCH", `${base}/lukeos-health?updateMask=endpointUri,endpointAuthorization,subscriberConfigs`, payload);
    });
    await updateStatus({ webhook: { registered: true, error: null, at } });
  } catch (err) {
    await updateStatus({ webhook: { registered: false, error: (err as Error).message, at } });
  }
}

/** Whether a webhook call carries the secret LukeOS gave Google. */
export async function webhookAuthorized(header: string | null) {
  const status = await read<Status>(STATE_KEY);
  return Boolean(header && status?.webhookSecret && same(header, `Bearer ${status.webhookSecret}`));
}

/** Whether a change notice is worth fetching for now (they come in bursts). */
export async function shouldSyncAfterNotice() {
  const status = await read<Status>(STATE_KEY);
  return !status?.lastSyncAt || Date.now() - Date.parse(status.lastSyncAt) > 2 * 60_000;
}

/* ---------- Reading ---------- */

export async function healthDays(first: string, last: string) {
  return db
    .select({ date: schema.healthDays.date, summary: schema.healthDays.summary })
    .from(schema.healthDays)
    .where(and(gte(schema.healthDays.date, first), lte(schema.healthDays.date, last)));
}

export async function healthRaw(date: string) {
  const [row] = await db.select().from(schema.healthDays).where(eq(schema.healthDays.date, date)).limit(1);
  return row?.raw ?? null;
}

/* ---------- One day in detail (fetched live, not saved) ---------- */

export type HealthDayDetail = {
  /** Steps in each hour of the day, midnight first (24 numbers; null where nothing was recorded). */
  stepsByHour: (number | null)[];
  /** Heart rate in 5-minute buckets (start time ISO), only buckets with readings. */
  heartRate: { time: string; bpm: number; min: number; max: number }[];
  /** The night's sleep stages in order (the main sleep that ended this day). */
  sleepStages: { stage: string; start: string; end: string }[];
};

async function rollUp(dataType: string, start: Date, end: Date, windowSeconds: number) {
  const points: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await api<{ rollupDataPoints?: Record<string, unknown>[]; nextPageToken?: string }>("POST", `/users/me/dataTypes/${dataType}/dataPoints:rollUp`, {
      range: { startTime: start.toISOString(), endTime: end.toISOString() },
      windowSize: `${windowSeconds}s`,
      pageSize: 1440,
      ...(pageToken ? { pageToken } : {}),
    });
    points.push(...(res.rollupDataPoints ?? []));
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return points;
}

/** Hour-by-hour steps, 5-minute heart rate and the sleep stage timeline for one day in Luke's time zone. */
export async function healthDayDetail(date: string): Promise<HealthDayDetail> {
  if (!(await read<Tokens>(TOKENS_KEY))) throw new HealthError("Fitbit isn't connected.");
  const timeZone = await getTimeZone();
  const start = momentIn(timeZone, date, "00:00");
  const end = momentIn(timeZone, addDays(date, 1), "00:00");
  const [steps, heart, raw] = await Promise.all([
    rollUp("steps", start, end, 3600).catch(() => []),
    rollUp("heart-rate", start, end, 300).catch(() => []),
    healthRaw(date),
  ]);

  const stepsByHour: (number | null)[] = Array(24).fill(null);
  for (const p of steps) {
    const at = Date.parse(String(p.startTime ?? ""));
    const hour = Number(timeIn(timeZone, new Date(at)).slice(0, 2));
    const n = num(field(p, "steps").countSum);
    if (Number.isFinite(hour) && n !== null) stepsByHour[hour] = (stepsByHour[hour] ?? 0) + n;
  }

  const heartRate = heart
    .map((p) => {
      const v = field(p, "heartRate");
      const bpm = num(v.beatsPerMinuteAvg);
      return bpm === null ? null : { time: String(p.startTime ?? ""), bpm: Math.round(bpm), min: Math.round(num(v.beatsPerMinuteMin) ?? bpm), max: Math.round(num(v.beatsPerMinuteMax) ?? bpm) };
    })
    .filter((x): x is HealthDayDetail["heartRate"][number] => x !== null)
    .sort((a, b) => a.time.localeCompare(b.time));

  // The same night LukeOS shows for this day (every part of it).
  const night = nightOf(((raw as Record<string, Point[]> | null)?.sleep ?? []).map((p) => field(p, "sleep")));
  const sleepStages = night
    .flatMap((x) => (x.stages ?? []) as { type?: string; startTime?: string; endTime?: string }[])
    .filter((s) => s.type && s.startTime && s.endTime)
    .map((s) => ({ stage: String(s.type), start: String(s.startTime), end: String(s.endTime) }))
    .sort((a, b) => a.start.localeCompare(b.start));

  return { stepsByHour, heartRate, sleepStages };
}

/** Google's first page for a data type, untouched (for working out why something doesn't come in). */
export async function healthProbe(dataType: string, filter: string | undefined) {
  const q = new URLSearchParams({ pageSize: "5" });
  if (filter) q.set("filter", filter);
  return api<unknown>("GET", `/users/me/dataTypes/${dataType}/dataPoints?${q}`);
}
