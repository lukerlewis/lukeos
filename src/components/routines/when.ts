import { friendlyDay, todayIn } from "@/lib/dates";
import { timeLabel } from "@/lib/schedule";

/** "Today 8pm", "Tomorrow 5am", "Fri 8pm", "Thu 8 Oct 8pm", in Luke's time zone. */
export function whenShort(at: Date, timeZone: string) {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  return `${friendlyDay(todayIn(timeZone, at), todayIn(timeZone))} ${timeLabel(time)}`;
}
