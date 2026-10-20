/**
 * Due dates are plain calendar days ("2026-10-02"), with no time of day.
 * These helpers work on those strings so nothing shifts across time zones.
 */

import { repeatStep, type Repeat } from "@/lib/task-fields";

export const isoDay = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in the given time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function toUtc(day: string) {
  return new Date(`${day}T00:00:00Z`);
}

export function addDays(day: string, n: number) {
  const d = toUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The same day of the month, n months on. The 31st becomes the last day of a shorter month. */
export function addMonths(day: string, n: number) {
  const d = toUtc(day);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return target.toISOString().slice(0, 10);
}

/**
 * When a repeating task is next due, after finishing the one due on `due`
 * (or today, if it had no date). It keeps its rhythm (the same weekday, or
 * day of the month) and always lands after today, so finishing a late one
 * doesn't make another late one.
 */
export function nextRepeat(due: string | null, repeat: Repeat, today: string) {
  const start = due ?? today;
  const gap = repeatStep(repeat) ?? { n: 1, unit: "days" };
  const step = (n: number) =>
    gap.unit === "weeks"
      ? addDays(start, 7 * gap.n * n)
      : gap.unit === "months"
        ? addMonths(start, gap.n * n)
        : gap.unit === "years"
          ? addMonths(start, 12 * gap.n * n)
          : addDays(start, gap.n * n);
  let n = 1;
  // Weekdays steps a day at a time, passing over Saturday and Sunday.
  while (step(n) <= today || (repeat === "weekdays" && [0, 6].includes(toUtc(step(n)).getUTCDay()))) n++;
  return step(n);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string) {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** Sunday that ends the week containing `day` (weeks run Monday to Sunday). */
export function endOfWeek(day: string) {
  const weekday = (toUtc(day).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, 6 - weekday);
}

export function endOfMonth(day: string) {
  const d = toUtc(day);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

// Formatted by hand rather than with toLocaleDateString, because the server
// and browsers disagree on details ("Sep" vs "Sept"), which breaks hydration.
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "30 Sep 2026" */
export function shortDate(day: string) {
  const d = toUtc(day);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Today", "Tomorrow", "Yesterday", "Fri", "Thu 8 Oct" or "8 Oct 2027". */
export function friendlyDay(day: string, today: string) {
  const diff = daysBetween(today, day);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const d = toUtc(day);
  if (diff > 1 && diff < 7) return weekdays[d.getUTCDay()];
  if (day.slice(0, 4) === today.slice(0, 4)) return `${weekdays[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
  return shortDate(day);
}

/**
 * Tomorrow, and where "This week" ends, as seen from `today`. This week is
 * the days after tomorrow up to Sunday. On a Saturday or Sunday that leaves
 * nothing, so "This week" means the coming week instead.
 */
export function whenWindows(today: string) {
  const tomorrow = addDays(today, 1);
  const weekEnd = endOfWeek(today) > tomorrow ? endOfWeek(today) : endOfWeek(addDays(today, 2));
  return { tomorrow, weekEnd };
}

/**
 * Which "when" bucket a due date falls in, matching the board's columns.
 * It's worked out from the date each time, so at midnight tomorrow's tasks
 * become today's on their own.
 */
export type When = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

export function whenOf(dueDate: string | null, today: string): When {
  if (!dueDate) return "none";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  const { tomorrow, weekEnd } = whenWindows(today);
  if (dueDate === tomorrow) return "tomorrow";
  if (dueDate <= weekEnd) return "week";
  return "later";
}

/** "4 Oct" */
export function dayAndMonth(day: string) {
  const d = toUtc(day);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

/** "Sun 4 Oct" */
export function weekdayDayAndMonth(day: string) {
  return `${weekdays[toUtc(day).getUTCDay()]} ${dayAndMonth(day)}`;
}

/** The time of day ("14:05") a moment falls at in the given time zone. */
export function timeIn(timeZone: string, at: Date) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  } catch {
    return at.toISOString().slice(11, 16);
  }
}

/** How far ahead of UTC the time zone is at that moment, in ms. */
function offsetAt(timeZone: string, at: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, Number(p.value)]),
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(at / 1000) * 1000;
}

/** The moment a day ("2026-10-13") and time ("14:05") in the given time zone stand for. */
export function momentIn(timeZone: string, day: string, time: string) {
  const wall = Date.parse(`${day}T${time}:00Z`);
  try {
    let at = wall - offsetAt(timeZone, wall);
    at = wall - offsetAt(timeZone, at); // once more, for days the clocks change
    return new Date(at);
  } catch {
    return new Date(wall);
  }
}
