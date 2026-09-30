import { Sidebar } from "@/components/shell/sidebar";
import { TabBar } from "@/components/shell/tab-bar";
import { TaskEditorProvider } from "@/components/tasks/task-editor";
import { TimeZoneSync } from "@/components/time-zone-sync";
import { listProjects } from "@/core/projects";
import { getTimeZone } from "@/core/settings";
import { requireSession } from "@/lib/auth/session";
import { todayIn } from "@/lib/dates";
import { colorHex } from "@/lib/project-colors";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireSession();
  const [projects, timeZone] = await Promise.all([listProjects(), getTimeZone()]);

  return (
    <TaskEditorProvider projects={projects} today={todayIn(timeZone)}>
      <TimeZoneSync saved={timeZone} />
      <div className="flex min-h-dvh md:h-dvh">
        <Sidebar projects={projects.map((p) => ({ id: p.id, name: p.name, hex: colorHex(p.color), open: p.openTasks }))} />
        <main className="flex min-w-0 grow md:overflow-y-auto">{children}</main>
        <TabBar />
      </div>
    </TaskEditorProvider>
  );
}
