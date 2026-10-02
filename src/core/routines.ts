import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { addDays, todayIn } from "@/lib/dates";
import {
  checkInsLabel,
  checkInTimes,
  DEFAULT_CHECK_INS,
  dueTimes,
  frequencies,
  pickUpWindow,
  scheduleLabel,
  timeLabel,
  timeOfDay,
  type CheckIns,
  type Frequency,
  type Schedule,
} from "@/lib/schedule";
import { listComments } from "./comments";
import { defineOperation, madeByColumns, madeByOf, OperationError, type MadeBy } from "./define";
import { listMentions } from "./mentions";
import { listMessages } from "./messages";
import { getTimeZone } from "./settings";
import { listSops } from "./sops";

/**
 * Routines are things Luke wants done on a schedule, kept in LukeOS so any
 * agent can do them. An agent checks in (get_inbox) at Luke's check-in
 * times, sees which routines are due, claims each one (start_routine_run, so
 * two check-ins can't both do it), and marks it finished. A due time that
 * nobody picks up before the next check-in is skipped and shown as missed.
 */

const { routines, routineRuns, sops, appSettings } = schema;

const CHECK_INS_KEY = "check_ins";
/** A check-in that starts a touch early still counts things due a few minutes later. */
const EARLY_MS = 10 * 60_000;
/** How far back to look for due or missed runs. Longer than any gap between check-ins. */
const LOOK_BACK_DAYS = 7;
/** A run still going after this long probably stopped without saying so. */
const STALLED_MS = 3 * 3600_000;

export type RunStatus = "running" | "done" | "failed" | "missed" | "stalled";

export type RoutineRun = {
  id: string;
  dueAt: Date;
  status: RunStatus;
  agentName: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  summary: string | null;
  artifact: { id: string; title: string } | null;
};

export type RoutineSummary = Schedule & {
  id: string;
  title: string;
  enabled: boolean;
  /** "Every day at 8pm". */
  scheduleLabel: string;
  sop: { id: string; title: string } | null;
  /** The next time it's due, if it's on. */
  nextDueAt: Date | null;
  lastRun: RoutineRun | null;
  madeBy: MadeBy;
  createdAt: Date;
  updatedAt: Date;
};

export type Routine = RoutineSummary & { instructions: string; runs: RoutineRun[] };

// ---------------------------------------------------------------------------
// Check-in times

export async function getCheckIns(): Promise<CheckIns> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, CHECK_INS_KEY)).limit(1);
  if (!row) return DEFAULT_CHECK_INS;
  try {
    const value = JSON.parse(row.value) as CheckIns;
    return { times: value.times ?? [], days: value.days ?? [] };
  } catch {
    return DEFAULT_CHECK_INS;
  }
}

/** The next time an agent will check in, or null if no check-in times are set. */
export async function nextCheckIn(now = new Date()) {
  const [checkIns, timeZone] = await Promise.all([getCheckIns(), getTimeZone()]);
  const day = todayIn(timeZone, now);
  return checkInTimes(checkIns, day, addDays(day, 8), timeZone).find((t) => t > now) ?? null;
}

// ---------------------------------------------------------------------------
// Reading

type Row = typeof routines.$inferSelect;

const live = isNull(routines.deletedAt);
const scheduleOf = (r: Row): Schedule => ({
  frequency: r.frequency as Frequency,
  time: r.time,
  days: r.days,
  dayOfMonth: r.dayOfMonth,
});

function runOf(row: typeof routineRuns.$inferSelect, artifactTitle: string | null, now: Date): RoutineRun {
  const stalled = row.status === "running" && row.startedAt && now.getTime() - row.startedAt.getTime() > STALLED_MS;
  return {
    id: row.id,
    dueAt: row.dueAt,
    status: stalled ? "stalled" : (row.status as RunStatus),
    agentName: row.agentName,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    summary: row.summary,
    artifact: row.artifactId ? { id: row.artifactId, title: artifactTitle ?? "Untitled" } : null,
  };
}

async function runsFor(routineIds: string[], limit: number | "latest") {
  if (routineIds.length === 0) return [];
  const now = new Date();
  const artifactTitle = sql<string | null>`(select a.title from artifacts a where a.id = ${routineRuns.artifactId} and a.deleted_at is null)`;
  const base = db
    .select({ run: routineRuns, artifactTitle })
    .from(routineRuns)
    .where(
      limit === "latest"
        ? sql`${routineRuns.id} in (select distinct on (r.routine_id) r.id from routine_runs r
            where r.routine_id in ${routineIds} order by r.routine_id, r.due_at desc)`
        : inArray(routineRuns.routineId, routineIds),
    )
    .orderBy(desc(routineRuns.dueAt));
  const rows = limit === "latest" ? await base : await base.limit(limit);
  return rows.map(({ run, artifactTitle }) => ({ routineId: run.routineId, run: runOf(run, artifactTitle, now) }));
}

async function sopTitles(ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: sops.id, title: sops.title })
    .from(sops)
    .where(and(inArray(sops.id, ids), isNull(sops.deletedAt)));
  return new Map(rows.map((r) => [r.id, r.title || "Untitled SOP"]));
}

/** The next time a routine is due, after now. */
function nextDue(r: Row, timeZone: string, now: Date) {
  if (!r.enabled) return null;
  const today = todayIn(timeZone, now);
  return dueTimes(scheduleOf(r), today, addDays(today, 62), timeZone).find((t) => t > now) ?? null;
}

async function summaries(rows: Row[]): Promise<RoutineSummary[]> {
  const [timeZone, last, titles] = await Promise.all([
    getTimeZone(),
    runsFor(
      rows.map((r) => r.id),
      "latest",
    ),
    sopTitles(rows.flatMap((r) => (r.sopId ? [r.sopId] : []))),
  ]);
  const now = new Date();
  return rows.map((r) => {
    const s = scheduleOf(r);
    return {
      id: r.id,
      title: r.title,
      enabled: r.enabled,
      ...s,
      scheduleLabel: scheduleLabel(s),
      sop: r.sopId && titles.has(r.sopId) ? { id: r.sopId, title: titles.get(r.sopId)! } : null,
      nextDueAt: nextDue(r, timeZone, now),
      lastRun: last.find((l) => l.routineId === r.id)?.run ?? null,
      madeBy: madeByOf(r),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

/** Every routine, A to Z. */
export async function listRoutines() {
  await settleMissed();
  const rows = await db.select().from(routines).where(live).orderBy(sql`lower(${routines.title})`, routines.createdAt);
  return summaries(rows);
}

async function routineRow(id: string) {
  const [row] = await db
    .select()
    .from(routines)
    .where(and(eq(routines.id, id), live))
    .limit(1);
  if (!row) throw new OperationError("That routine doesn't exist, or it's in Trash.", 404);
  return row;
}

export async function getRoutine(id: string, runLimit = 20): Promise<Routine> {
  const row = await routineRow(id);
  const [[summary], runs] = await Promise.all([summaries([row]), runsFor([id], runLimit)]);
  return { ...summary, instructions: row.instructions, runs: runs.map((r) => r.run) };
}

// ---------------------------------------------------------------------------
// What's due

type Due = { routine: Row; dueAt: Date; until: Date };

/**
 * Due times from the last week with no run yet: ones still waiting for a
 * check-in, and ones whose chance has gone (the next check-in came and went).
 */
async function dueState(now = new Date()) {
  const [timeZone, checkIns, rows] = await Promise.all([
    getTimeZone(),
    getCheckIns(),
    db
      .select()
      .from(routines)
      .where(and(live, eq(routines.enabled, true))),
  ]);
  const waiting: Due[] = [];
  const missed: Due[] = [];
  if (rows.length === 0) return { waiting, missed };

  const today = todayIn(timeZone, now);
  const from = addDays(today, -LOOK_BACK_DAYS);
  const slots = checkInTimes(checkIns, from, addDays(today, 8), timeZone);
  // A routine with nothing written yet (one Luke is just making) isn't due.
  const candidates = rows.filter((r) => r.title.trim() || r.instructions.trim()).flatMap((routine) =>
    dueTimes(scheduleOf(routine), from, addDays(today, 1), timeZone)
      .filter((t) => t >= routine.scheduledFrom && t.getTime() <= now.getTime() + EARLY_MS)
      .map((dueAt) => ({ routine, dueAt, until: pickUpWindow(dueAt, slots).until })),
  );
  if (candidates.length === 0) return { waiting, missed };

  const existing = await db
    .select({ routineId: routineRuns.routineId, dueAt: routineRuns.dueAt })
    .from(routineRuns)
    .where(
      and(
        inArray(
          routineRuns.routineId,
          rows.map((r) => r.id),
        ),
        sql`${routineRuns.dueAt} >= ${new Date(now.getTime() - (LOOK_BACK_DAYS + 2) * 86_400_000)}`,
      ),
    );
  const done = new Set(existing.map((e) => `${e.routineId}@${e.dueAt.getTime()}`));
  for (const c of candidates) {
    if (done.has(`${c.routine.id}@${c.dueAt.getTime()}`)) continue;
    (now < c.until ? waiting : missed).push(c);
  }
  return { waiting, missed };
}

/** Records due times nobody picked up in time as missed, so the history shows them. */
export async function settleMissed(now = new Date()) {
  const { missed } = await dueState(now);
  if (missed.length === 0) return;
  await db
    .insert(routineRuns)
    .values(missed.map((m) => ({ routineId: m.routine.id, dueAt: m.dueAt, status: "missed" })))
    .onConflictDoNothing();
}

/** Routines due now that nobody has started. */
export async function dueRoutines(now = new Date()) {
  const { waiting, missed } = await dueState(now);
  if (missed.length)
    await db
      .insert(routineRuns)
      .values(missed.map((m) => ({ routineId: m.routine.id, dueAt: m.dueAt, status: "missed" })))
      .onConflictDoNothing();
  // If one routine is somehow due twice, only the latest counts.
  const latest = new Map<string, Due>();
  for (const w of waiting) if (!latest.has(w.routine.id) || latest.get(w.routine.id)!.dueAt < w.dueAt) latest.set(w.routine.id, w);
  return [...latest.values()].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

/** "Today at 8pm", "Thu 1 Oct at 8pm", in Luke's time zone. */
function whenLabel(at: Date, timeZone: string, now = new Date()) {
  const day = todayIn(timeZone, at);
  const today = todayIn(timeZone, now);
  const time = timeLabel(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at),
  );
  if (day === today) return `today at ${time}`;
  if (day === addDays(today, -1)) return `yesterday at ${time}`;
  if (day === addDays(today, 1)) return `tomorrow at ${time}`;
  const d = new Date(`${day}T00:00:00Z`);
  const label = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d);
  return `${label} at ${time}`;
}

// ---------------------------------------------------------------------------
// Operations

const id = z.uuid().describe("The routine's id, from list_routines or get_inbox.");
const frequency = z.enum(frequencies).describe('"daily" (every day), "weekly" (on the days given) or "monthly" (on dayOfMonth).');
const time = z
  .string()
  .regex(timeOfDay, 'A time like "20:00".')
  .describe(
    'Time of day in Luke\'s time zone, 24 hour, e.g. "20:00". Use one of his check-in times (get_inbox or list_routines shows them): a routine runs at the first check-in at or after its time.',
  );
const days = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .max(7)
  .describe("Weekly only: the days it runs, 0 = Sunday, 1 = Monday ... 6 = Saturday.");
const dayOfMonth = z.number().int().min(1).max(31).describe("Monthly only: the day of the month (past the end of a short month, it runs on the last day).");
const instructions = z
  .string()
  .max(100_000)
  .describe("What to do each time, in Markdown. Say what to make (usually an artifact) and anything to check or include.");
const sopId = z.uuid().nullable().describe("An SOP to follow while doing it (from list_sops), or null for none.");

async function assertSop(id: string | null | undefined) {
  if (!id) return;
  const [row] = await db
    .select({ id: sops.id })
    .from(sops)
    .where(and(eq(sops.id, id), isNull(sops.deletedAt)))
    .limit(1);
  if (!row) throw new OperationError("That SOP doesn't exist, or it's in Trash. list_sops shows them all.", 404);
}

/** Compact shape for Claude, without the full run history. */
const forClaude = (r: RoutineSummary, timeZone: string) => ({
  id: r.id,
  title: r.title,
  enabled: r.enabled,
  schedule: r.scheduleLabel,
  frequency: r.frequency,
  time: r.time,
  days: r.days,
  dayOfMonth: r.dayOfMonth,
  sop: r.sop,
  next: r.nextDueAt ? whenLabel(r.nextDueAt, timeZone) : null,
  lastRun: r.lastRun ? { status: r.lastRun.status, dueAt: r.lastRun.dueAt, summary: r.lastRun.summary } : null,
});

export const routineOperations = {
  get_inbox: defineOperation({
    name: "get_inbox",
    description:
      "Everything waiting for an agent right now: Luke's messages waiting for an answer, his open @claude requests, comments waiting for a reply, and routines that are due. Call this first when you check in. If nothingToDo is true, stop: there's nothing to do. For each routine, call start_routine_run before doing it (it gives you the instructions), then finish_routine_run.",
    input: z.object({}),
    run: async () => {
      const now = new Date();
      const [timeZone, checkIns, due, mentions, comments, waitingMessages] = await Promise.all([
        getTimeZone(),
        getCheckIns(),
        dueRoutines(now),
        listMentions({ open: true, limit: 50 }),
        listComments({ open: true, limit: 50 }),
        listMessages({ waiting: true, limit: 50 }),
      ]);
      const waitingComments = comments.filter((c) => (c.replies.at(-1) ?? c).madeBy.kind === "user");
      const nothingToDo =
        due.length === 0 && mentions.length === 0 && waitingComments.length === 0 && waitingMessages.length === 0;
      return {
        now: new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "full", timeStyle: "short" }).format(now),
        timeZone,
        nothingToDo,
        messages: waitingMessages.map((m) => ({ id: m.id, text: m.text, link: m.link, sentAt: m.createdAt })),
        routines: due.map((d) => ({
          id: d.routine.id,
          title: d.routine.title,
          due: whenLabel(d.dueAt, timeZone, now),
          dueAt: d.dueAt,
        })),
        mentions: mentions.map((m) => ({ id: m.id, text: m.text, where: m.where, createdAt: m.createdAt })),
        comments: waitingComments.map((c) => ({
          id: c.id,
          on: c.target,
          quote: c.quote,
          comment: c.body,
          // The back and forth so far, so the latest reply reads in context.
          replies: c.replies.map((r) => ({ from: r.madeBy.kind === "user" ? "Luke" : (r.madeBy.name ?? "Claude"), text: r.body })),
          createdAt: c.createdAt,
        })),
        ...(nothingToDo
          ? {}
          : { sops: (await listSops()).map((s) => ({ title: s.title, description: s.description })) }),
        checkIns: checkInsLabel(checkIns),
      };
    },
  }),

  list_routines: defineOperation({
    name: "list_routines",
    description:
      "Luke's routines: things he wants done on a schedule (e.g. an end of day recap), with when each runs, the SOP it follows, when it's next due and how its last run went. Also says when agents check in. To do routines that are due, use get_inbox.",
    input: z.object({}),
    run: async () => {
      const [list, timeZone, checkIns] = await Promise.all([listRoutines(), getTimeZone(), getCheckIns()]);
      return { checkIns: checkInsLabel(checkIns), routines: list.map((r) => forClaude(r, timeZone)) };
    },
  }),

  get_routine: defineOperation({
    name: "get_routine",
    description: "One routine in full: its instructions, schedule, SOP, and its recent runs (what was done, and any that were missed).",
    input: z.object({ id }),
    run: async ({ id }) => getRoutine(id),
  }),

  create_routine: defineOperation({
    name: "create_routine",
    description:
      "Add a routine: something to do on a schedule. Only when Luke asks. It runs at the first check-in at or after its time, so pick one of his check-in times.",
    input: z.object({
      title: z.string().trim().max(200).optional().describe('A short name, e.g. "End of day recap".'),
      instructions: instructions.optional(),
      frequency: frequency.optional(),
      time: time.optional(),
      days: days.optional(),
      dayOfMonth: dayOfMonth.optional(),
      sopId: sopId.optional(),
      enabled: z.boolean().optional().describe("false to add it switched off. Defaults to on."),
    }),
    run: async (input, { actor }) => {
      await assertSop(input.sopId);
      const [row] = await db
        .insert(routines)
        .values({
          title: input.title ?? "",
          instructions: input.instructions ?? "",
          ...(input.frequency && { frequency: input.frequency }),
          ...(input.time && { time: input.time }),
          ...(input.days && { days: [...new Set(input.days)].sort() }),
          ...(input.dayOfMonth && { dayOfMonth: input.dayOfMonth }),
          sopId: input.sopId ?? null,
          enabled: input.enabled ?? true,
          ...madeByColumns(actor),
        })
        .returning({ id: routines.id });
      return getRoutine(row.id, 0);
    },
  }),

  update_routine: defineOperation({
    name: "update_routine",
    description: "Change a routine: its name, instructions, schedule, SOP, or switch it on or off. Only when Luke asks. Fields left out stay as they are.",
    input: z.object({
      id,
      title: z.string().trim().max(200).optional(),
      instructions: instructions.optional(),
      frequency: frequency.optional(),
      time: time.optional(),
      days: days.optional(),
      dayOfMonth: dayOfMonth.optional(),
      sopId: sopId.optional(),
      enabled: z.boolean().optional().describe("false switches it off: it won't be due until it's switched back on."),
    }),
    run: async ({ id, title, instructions, frequency, time, days, dayOfMonth, sopId, enabled }) => {
      const before = await routineRow(id);
      await assertSop(sopId);
      const scheduleChanged =
        (frequency !== undefined && frequency !== before.frequency) ||
        (time !== undefined && time !== before.time) ||
        (days !== undefined && [...new Set(days)].sort().join() !== before.days.join()) ||
        (dayOfMonth !== undefined && dayOfMonth !== before.dayOfMonth) ||
        (enabled === true && !before.enabled);
      await db
        .update(routines)
        .set({
          ...(title !== undefined && { title }),
          ...(instructions !== undefined && { instructions }),
          ...(frequency !== undefined && { frequency }),
          ...(time !== undefined && { time }),
          ...(days !== undefined && { days: [...new Set(days)].sort() }),
          ...(dayOfMonth !== undefined && { dayOfMonth }),
          ...(sopId !== undefined && { sopId }),
          ...(enabled !== undefined && { enabled }),
          // A new time from now on: earlier times under the old schedule don't become due or missed.
          ...(scheduleChanged && { scheduledFrom: new Date() }),
          updatedAt: new Date(),
        })
        .where(eq(routines.id, id));
      return getRoutine(id, 0);
    },
  }),

  delete_routine: defineOperation({
    name: "delete_routine",
    description: "Move a routine to Trash (kept for 30 days). It stops running. Only when Luke asks.",
    input: z.object({ id }),
    run: async ({ id }) => {
      await routineRow(id);
      await db.update(routines).set({ deletedAt: new Date() }).where(eq(routines.id, id));
      return { deleted: id };
    },
  }),

  start_routine_run: defineOperation({
    name: "start_routine_run",
    description:
      "Claim a due routine before doing it, so no other check-in does it too. Returns its instructions and the SOP to follow (read it with get_sop). If it's already been started or done, you'll get an error: skip it. When you're finished, call finish_routine_run with the run's id. Pass now: true only when Luke asks for a routine to run right away.",
    input: z.object({
      id,
      now: z.boolean().optional().describe("Run it now even though it isn't due (only when Luke asks)."),
    }),
    run: async ({ id, now: runNow }, { actor }) => {
      const routine = await routineRow(id);
      const timeZone = await getTimeZone();
      let dueAt: Date;
      if (runNow) {
        dueAt = new Date(Math.floor(Date.now() / 60_000) * 60_000);
      } else {
        const due = (await dueRoutines()).find((d) => d.routine.id === id);
        if (!due) {
          const [last] = await runsFor([id], 1);
          const lastLine =
            last && last.run.status !== "missed"
              ? ` Its last run (due ${whenLabel(last.run.dueAt, timeZone)}) is ${last.run.status === "running" ? "already in progress" : last.run.status}.`
              : "";
          throw new OperationError(`"${routine.title || "Untitled"}" isn't due right now.${lastLine} Skip it.`, 409);
        }
        dueAt = due.dueAt;
      }
      const [run] = await db
        .insert(routineRuns)
        .values({
          routineId: id,
          dueAt,
          status: "running",
          agentName: actor.kind === "agent" ? actor.name : "Luke",
          startedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: routineRuns.id });
      if (!run) throw new OperationError(`"${routine.title || "Untitled"}" has already been started for that time. Skip it.`, 409);
      const [sop] = routine.sopId
        ? await db
            .select({ id: sops.id, title: sops.title })
            .from(sops)
            .where(and(eq(sops.id, routine.sopId), isNull(sops.deletedAt)))
            .limit(1)
        : [];
      return {
        runId: run.id,
        routine: { id: routine.id, title: routine.title, due: whenLabel(dueAt, timeZone) },
        instructions: routine.instructions || "(No instructions written yet. Do what the title suggests, briefly.)",
        sop: sop ?? null,
        reminder: `Pass routine: "${routine.title}" on everything you create or change, then call finish_routine_run with runId.`,
      };
    },
  }),

  finish_routine_run: defineOperation({
    name: "finish_routine_run",
    description:
      'Mark a routine run as finished: status "done", or "failed" if you couldn\'t do it (say why in summary). Include a one or two sentence summary of what you did, and the artifact you made, if any.',
    input: z.object({
      runId: z.uuid().describe("From start_routine_run."),
      status: z.enum(["done", "failed"]).optional().describe('Defaults to "done".'),
      summary: z.string().trim().max(2000).optional().describe("What you did, in a sentence or two. Luke sees it in the routine's history."),
      artifactId: z.uuid().optional().describe("The artifact you made this run, if any."),
    }),
    run: async ({ runId, status = "done", summary, artifactId }) => {
      const [row] = await db.select().from(routineRuns).where(eq(routineRuns.id, runId)).limit(1);
      if (!row) throw new OperationError("That run doesn't exist. Use the runId start_routine_run gave you.", 404);
      if (row.status === "missed") throw new OperationError("That run was never started.", 409);
      await db
        .update(routineRuns)
        .set({ status, summary: summary || null, artifactId: artifactId ?? null, finishedAt: new Date() })
        .where(eq(routineRuns.id, runId));
      const routine = await routineRow(row.routineId).catch(() => null);
      return { runId, routine: routine ? { id: routine.id, title: routine.title } : null, status };
    },
  }),

  set_check_in_times: defineOperation({
    name: "set_check_in_times",
    description:
      "Change when agents check in, which decides when routines actually run. Only when Luke asks, and change your own scheduled check-in to match.",
    input: z.object({
      times: z.array(z.string().regex(timeOfDay)).max(24).describe('Times of day, e.g. ["05:00", "08:00"].'),
      days: z.array(z.number().int().min(0).max(6)).max(7).describe("Days, 0 = Sunday ... 6 = Saturday."),
    }),
    run: async ({ times, days }) => {
      const value: CheckIns = { times: [...new Set(times)].sort(), days: [...new Set(days)].sort() };
      await db
        .insert(appSettings)
        .values({ key: CHECK_INS_KEY, value: JSON.stringify(value) })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(value) } });
      return { checkIns: checkInsLabel(value), ...value };
    },
  }),
};
