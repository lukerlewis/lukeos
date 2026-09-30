import type { ActivityEntry } from "@/core/activity";
import { friendlyDay, todayIn } from "@/lib/dates";
import type { ActivityRow } from "./activity-list";

/** Splits activity log entries into days, with times in Luke's time zone, ready for ActivityList. */
export function activityDays(entries: ActivityEntry[], timeZone: string) {
  const today = todayIn(timeZone);
  // "8:05 pm"
  const clock = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true });
  const days: { label: string; rows: ActivityRow[] }[] = [];
  let current = "";
  for (const e of entries) {
    const day = todayIn(timeZone, e.at);
    if (day !== current) {
      current = day;
      days.push({ label: friendlyDay(day, today), rows: [] });
    }
    days.at(-1)!.rows.push({
      id: e.id,
      time: clock.format(e.at).replace(/\s*(AM|PM)$/, (_, m: string) => ` ${m.toLowerCase()}`),
      summary: e.summary,
      who: e.routine ?? (e.name !== "Claude" ? e.name : null),
      item: e.item,
    });
  }
  return days;
}
