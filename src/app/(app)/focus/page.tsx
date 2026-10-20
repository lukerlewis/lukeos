import type { Metadata } from "next";
import { FocusScreen, LengthsButton } from "@/components/focus/focus-screen";
import { Page } from "@/components/shell/page";
import { getScratchPad } from "@/core/focus";
import { listTasks } from "@/core/tasks";

export const metadata: Metadata = { title: "Focus · LukeOS" };

/**
 * A pomodoro timer, a regular timer, focus sprints and brown noise. The timers
 * themselves live in the app's frame; the open tasks are for picking a sprint's,
 * and the scratch pad sits under them.
 */
export default async function FocusPage() {
  const [tasks, scratchPad] = await Promise.all([listTasks({}), getScratchPad()]);
  const openTasks = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    bucket: t.bucket,
    effort: t.effort,
    priority: t.priority,
    project: t.project && { name: t.project.name, hex: t.project.hex },
  }));
  return (
    <Page title="Focus" newTask={false} actions={<LengthsButton />}>
      <FocusScreen openTasks={openTasks} scratchPad={scratchPad} />
    </Page>
  );
}
