/**
 * Due dates are plain calendar days ("2026-10-02"), with no time of day.
 * These helpers work on those strings so nothing shifts across time zones.
 */

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
export function nextRepeat(due: string | null, repeat: "daily" | "weekly" | "monthly", today: string) {
  const start = due ?? today;
  const step = (n: number) => (repeat === "daily" ? addDays(start, n) : repeat === "weekly" ? addDays(start, 7 * n) : addMonths(start, n));
  let n = 1;
  while (step(n) <= today) n++;
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
