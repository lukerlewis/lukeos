import type { Metadata } from "next";
import { FocusScreen, LengthsButton } from "@/components/focus/focus-screen";
import { Page } from "@/components/shell/page";
import { listTasks } from "@/core/tasks";

export const metadata: Metadata = { title: "Focus · LukeOS" };

/**
 * A pomodoro timer, a regular timer, focus sprints and brown noise. The timers
 * themselves live in the app's frame; the open tasks are for picking a sprint's.
 */
export default async function FocusPage() {
  const tasks = await listTasks({});
  const openTasks = tasks.map((t) => ({ id: t.id, title: t.title, bucket: t.bucket, project: t.project && { name: t.project.name } }));
  return (
    <Page title="Focus" newTask={false} actions={<LengthsButton />}>
      <FocusScreen openTasks={openTasks} />
    </Page>
  );
}
