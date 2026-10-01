import { addDays } from "./dates";

/**
 * Routine schedules and check-in times. Times are wall-clock times in Luke's
 * time zone ("20:00"); these helpers turn them into real moments, so the
 * same routine runs at 8pm whether it's summer or winter time.
 */

export const frequencies = ["daily", "weekly", "monthly"] as const;
export type Frequency = (typeof frequencies)[number];

export type Schedule = {
  frequency: Frequency;
  /** "HH:MM", 24 hour. */
  time: string;
  /** Weekly: 0 = Sunday ... 6 = Saturday. */
  days: number[];
  /** Monthly: 1 to 31. Past the end of a short month, it's the last day. */
  dayOfMonth: number;
};

/** When an agent checks in to see what's waiting: these times, on these days. */
export type CheckIns = { times: string[]; days: number[] };

/** Luke's choice (1 Oct 2026): 5am, 8am, 11am, 2pm, 5pm and 8pm, Monday to Saturday. */
export const DEFAULT_CHECK_INS: CheckIns = {
  times: ["05:00", "08:00", "11:00", "14:00", "17:00", "20:00"],
  days: [1, 2, 3, 4, 5, 6],
};

export const timeOfDay = /^([01]\d|2[0-3]):[0-5]\d$/;

export const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const longDayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "8pm", "5:30am", "12pm". */
export function timeLabel(time: string) {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, "0")}${suffix}` : `${hour}${suffix}`;
}

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

/** "Mon to Fri", "Mon, Wed and Fri", "Every day". */
export function daysLabel(days: number[]) {
  const sorted = [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // Monday first
  if (sorted.length === 7) return "every day";
  if (sorted.length === 0) return "no days";
  const mondayFirst = sorted.map((d) => (d + 6) % 7);
  const run = mondayFirst.every((d, i) => i === 0 || d === mondayFirst[i - 1] + 1);
  if (run && sorted.length >= 3) return `${dayNames[sorted[0]]} to ${dayNames[sorted.at(-1)!]}`;
  if (sorted.length === 1) return `${longDayNames[sorted[0]]}s`;
  const names = sorted.map((d) => dayNames[d]);
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** "Every day at 8pm", "Mon to Fri at 5pm", "Monthly on the 1st at 8am". */
export function scheduleLabel(s: Schedule) {
  const at = `at ${timeLabel(s.time)}`;
  if (s.frequency === "daily") return `Every day ${at}`;
  if (s.frequency === "weekly") {
    const d = daysLabel(s.days);
    return d === "every day" ? `Every day ${at}` : `${d[0].toUpperCase()}${d.slice(1)} ${at}`;
  }
  return `Monthly on the ${ordinal(s.dayOfMonth)} ${at}`;
}

/** "5am, 8am, 11am, 2pm, 5pm and 8pm, Mon to Sat". */
export function checkInsLabel(c: CheckIns) {
  if (c.times.length === 0) return "no set times";
  const times = [...c.times].sort().map(timeLabel);
  const list = times.length === 1 ? times[0] : `${times.slice(0, -1).join(", ")} and ${times.at(-1)}`;
  return `${list}, ${daysLabel(c.days)}`;
}

const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** Does the routine run on this calendar day? */
export function runsOn(s: Schedule, day: string) {
  if (s.frequency === "daily") return true;
  if (s.frequency === "weekly") return s.days.includes(weekdayOf(day));
  const d = new Date(`${day}T00:00:00Z`);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return d.getUTCDate() === Math.min(s.dayOfMonth, last);
}

/** How far ahead of UTC the time zone is at that moment, in ms. */
function offsetAt(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** The moment it's `time` on `day` in the time zone. */
export function atLocal(day: string, time: string, timeZone: string) {
  const [y, mo, d] = day.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wall - offsetAt(new Date(wall), timeZone);
  // Near a clock change the offset can differ at the real moment; one more pass settles it.
  guess = wall - offsetAt(new Date(guess), timeZone);
  return new Date(guess);
}

/** A routine's due times between two calendar days (inclusive), oldest first. */
export function dueTimes(s: Schedule, fromDay: string, toDay: string, timeZone: string) {
  const out: Date[] = [];
  for (let day = fromDay; day <= toDay; day = addDays(day, 1)) if (runsOn(s, day)) out.push(atLocal(day, s.time, timeZone));
  return out;
}

/** Every check-in between two calendar days (inclusive), oldest first. */
export function checkInTimes(c: CheckIns, fromDay: string, toDay: string, timeZone: string) {
  const times = [...new Set(c.times)].sort();
  const out: Date[] = [];
  for (let day = fromDay; day <= toDay; day = addDays(day, 1))
    if (c.days.includes(weekdayOf(day))) for (const t of times) out.push(atLocal(day, t, timeZone));
  return out;
}

/**
 * For something due at `due`: the check-in that should pick it up (the first
 * one at or after it), and when its chance has gone (the check-in after that).
 * With no check-in times set, it has a day.
 */
export function pickUpWindow(due: Date, checkIns: Date[]) {
  const i = checkIns.findIndex((c) => c >= due);
  if (i === -1) return { pickUp: due, until: new Date(due.getTime() + 24 * 3600_000) };
  const pickUp = checkIns[i];
  const until = checkIns[i + 1] ?? new Date(pickUp.getTime() + 24 * 3600_000);
  return { pickUp, until };
}
