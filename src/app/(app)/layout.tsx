import { after } from "next/server";
import { Suspense } from "react";
import { CommandMenuProvider } from "@/components/command/command-menu";
import { PullToRefresh } from "@/components/shell/pull-to-refresh";
import { PushListener } from "@/components/shell/push-listener";
import { Sidebar } from "@/components/shell/sidebar";
import { TabBar } from "@/components/shell/tab-bar";
import { Toaster } from "@/components/shell/toast";
import { FocusProvider } from "@/components/focus/focus-provider";
import { TaskEditorProvider } from "@/components/tasks/task-editor";
import { TimeZoneSync } from "@/components/time-zone-sync";
import { getFocusSettings } from "@/core/focus";
import { newFromClaudeCount } from "@/core/from-claude";
import { unreadMessageCount } from "@/core/messages";
import { listProjects } from "@/core/projects";
import { getTimeZone } from "@/core/settings";
import { purgeExpiredTrash } from "@/core/trash";
import { requireSession } from "@/lib/auth/session";
import { todayIn } from "@/lib/dates";
import { colorHex } from "@/lib/project-colors";
import Loading from "./loading";

// Every screen shows Luke's own data, so none is built ahead of time.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: LayoutProps<"/">) {
  // The frame and a loading outline go out straight away; the sidebar's data
  // and the screen fill in once the database answers, so opening the app
  // after a break never shows a blank page.
  return (
    <Suspense fallback={<ShellLoading />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}

async function AppShell({ children }: { children: React.ReactNode }) {
  await requireSession();
  const [projects, timeZone, newFromClaude, unreadMessages, focusSettings] = await Promise.all([
    listProjects(),
    getTimeZone(),
    newFromClaudeCount(),
    unreadMessageCount(),
    getFocusSettings(),
  ]);
  // Things over 30 days in Trash are deleted for good as the app is used.
  after(() => purgeExpiredTrash().catch((err) => console.error("[trash] purge failed", err)));
  const today = todayIn(timeZone);
  const menuProjects = projects.map((p) => ({ id: p.id, name: p.name, hex: colorHex(p.color) }));

  return (
    <TaskEditorProvider projects={projects} today={today} timeZone={timeZone}>
      <CommandMenuProvider projects={menuProjects} today={today}>
        <FocusProvider settings={focusSettings}>
        <TimeZoneSync saved={timeZone} />
        <PushListener />
        <PullToRefresh />
        <div className="flex min-h-dvh md:h-dvh">
          <Sidebar
            projects={projects.map((p) => ({ id: p.id, name: p.name, hex: colorHex(p.color), open: p.openTasks }))}
            newFromClaude={newFromClaude}
            unreadMessages={unreadMessages}
          />
          <main className="flex min-w-0 grow md:overflow-y-auto">{children}</main>
          <TabBar unreadMessages={unreadMessages} />
        </div>
        <Toaster />
        </FocusProvider>
      </CommandMenuProvider>
    </TaskEditorProvider>
  );
}

/** The app's frame with grey placeholders, shown while the first screen loads. */
function ShellLoading() {
  return (
    <div className="flex min-h-dvh md:h-dvh">
      <aside className="hidden w-60 shrink-0 flex-col gap-4 border-r bg-sidebar px-3 py-3.5 md:flex" aria-hidden>
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <span className="flex size-7 items-center justify-center rounded-[8px] bg-primary text-meta font-medium text-primary-foreground">
            L
          </span>
          <span className="font-medium text-ink">Luke&apos;s space</span>
        </div>
        <div className="h-10 rounded-lg border border-stroke-strong bg-card" />
        <div className="flex animate-pulse flex-col gap-3 px-2.5 pt-1">
          {[60, 45, 55, 50, 40].map((w, i) => (
            <div key={i} className="h-3.5 rounded bg-muted" style={{ width: `${w}%` }} />
          ))}
        </div>
      </aside>
      <main className="flex min-w-0 grow md:overflow-y-auto">
        <Loading />
      </main>
      <TabBar />
    </div>
  );
}
