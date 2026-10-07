import type { Metadata } from "next";
import { FocusScreen, LengthsButton } from "@/components/focus/focus-screen";
import { Page } from "@/components/shell/page";
import { focusSummary } from "@/core/focus";

export const metadata: Metadata = { title: "Focus · LukeOS" };

/** A pomodoro timer, a regular timer and brown noise. The timers themselves live in the app's frame. */
export default async function FocusPage() {
  const { todaySeconds, last7DaysSeconds } = await focusSummary(1);
  return (
    <Page title="Focus" newTask={false} actions={<LengthsButton />}>
      <FocusScreen todaySeconds={todaySeconds} weekSeconds={last7DaysSeconds} />
    </Page>
  );
}
