import type { Metadata } from "next";
import { FocusScreen, LengthsButton } from "@/components/focus/focus-screen";
import { Page } from "@/components/shell/page";

export const metadata: Metadata = { title: "Focus · LukeOS" };

/** A pomodoro timer, a regular timer and brown noise. The timers themselves live in the app's frame. */
export default function FocusPage() {
  return (
    <Page title="Focus" newTask={false} actions={<LengthsButton />}>
      <FocusScreen />
    </Page>
  );
}
