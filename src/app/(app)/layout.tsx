import { after } from "next/server";
import { CommandMenuProvider } from "@/components/command/command-menu";
import { Sidebar } from "@/components/shell/sidebar";
import { TabBar } from "@/components/shell/tab-bar";
import { Toaster } from "@/components/shell/toast";
import { TaskEditorProvider } from "@/components/tasks/task-editor";
import { TimeZoneSync } from "@/components/time-zone-sync";
import { newFromClaudeCount } from "@/core/from-claude";
import { listProjects } from "@/core/projects";
import { getTimeZone } from "@/core/settings";
import { purgeExpiredTrash } from "@/core/trash";
import { requireSession } from "@/lib/auth/session";
import { todayIn } from "@/lib/dates";
import { colorHex } from "@/lib/project-colors";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireSession();
  const [projects, timeZone, newFromClaude] = await Promise.all([listProjects(), getTimeZone(), newFromClaudeCount()]);
  // Things over 30 days in Trash are deleted for good as the app is used.
  after(() => purgeExpiredTrash().catch((err) => console.error("[trash] purge failed", err)));
  const today = todayIn(timeZone);
  const menuProjects = projects.map((p) => ({ id: p.id, name: p.name, hex: colorHex(p.color) }));

  return (
    <TaskEditorProvider projects={projects} today={today}>
      <CommandMenuProvider projects={menuProjects} today={today}>
        <TimeZoneSync saved={timeZone} />
        <div className="flex min-h-dvh md:h-dvh">
          <Sidebar
            projects={projects.map((p) => ({ id: p.id, name: p.name, hex: colorHex(p.color), open: p.openTasks }))}
            newFromClaude={newFromClaude}
          />
          <main className="flex min-w-0 grow md:overflow-y-auto">{children}</main>
          <TabBar />
        </div>
        <Toaster />
      </CommandMenuProvider>
    </TaskEditorProvider>
  );
}
