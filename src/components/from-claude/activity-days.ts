import type { ActivityEntry } from "@/core/activity";
import { friendlyDay, todayIn } from "@/lib/dates";
import type { ActivityRow } from "./activity-list";

/** Splits activity log entries into days, with times in Luke's time zone, ready for ActivityList. */
export function activityDays(entries: ActivityEntry[], timeZone: string) {
  const today = todayIn(timeZone);
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" });
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
      time: clock.format(e.at),
      summary: e.summary,
      who: e.routine ?? (e.name !== "Claude" ? e.name : null),
      item: e.item,
    });
  }
  return days;
}
