import { cookies } from "next/headers";
import { after } from "next/server";
import { Suspense } from "react";
import { CommandMenuProvider } from "@/components/command/command-menu";
import { PlaceMemory } from "@/components/shell/place-memory";
import { PullToRefresh } from "@/components/shell/pull-to-refresh";
import { KeepFresh } from "@/components/shell/keep-fresh";
import { PushListener } from "@/components/shell/push-listener";
import { SIDEBAR_COOKIE } from "@/components/shell/nav";
import { Sidebar } from "@/components/shell/sidebar";
import { TabBar } from "@/components/shell/tab-bar";
import { Toaster } from "@/components/shell/toast";
import { FocusProvider } from "@/components/focus/focus-provider";
import { ListenProvider } from "@/components/listen/listen-provider";
import { PlayerBar } from "@/components/listen/player-bar";
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

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const sidebarCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";
  // The frame and a loading outline go out straight away; the sidebar's data
  // and the screen fill in once the database answers, so opening the app
  // after a break never shows a blank page.
  return (
    <Suspense fallback={<ShellLoading sidebarCollapsed={sidebarCollapsed} />}>
      <AppShell sidebarCollapsed={sidebarCollapsed}>{children}</AppShell>
    </Suspense>
  );
}

async function AppShell({ children, sidebarCollapsed }: { children: React.ReactNode; sidebarCollapsed: boolean }) {
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
  const renderedAt = madeAt();
  const menuProjects = projects.map((p) => ({ id: p.id, name: p.name, hex: colorHex(p.color) }));

  return (
    <TaskEditorProvider projects={projects} today={today} timeZone={timeZone}>
      <CommandMenuProvider projects={menuProjects} today={today}>
        <FocusProvider settings={focusSettings}>
        <ListenProvider>
        <TimeZoneSync saved={timeZone} />
        <PushListener />
        <KeepFresh renderedAt={renderedAt} />
        <PullToRefresh />
        <Suspense>
          <PlaceMemory />
        </Suspense>
        <div className="flex min-h-dvh md:h-dvh">
          <Sidebar
            projects={projects.map((p) => ({ id: p.id, name: p.name, hex: colorHex(p.color), open: p.openTasks }))}
            newFromClaude={newFromClaude}
            unreadMessages={unreadMessages}
            collapsed={sidebarCollapsed}
          />
          {/* On computers the player sits under the screen; on phones it floats above the tab bar. */}
          <div className="flex min-w-0 grow flex-col md:min-h-0">
            <main className="flex min-w-0 grow md:min-h-0 md:overflow-y-auto">{children}</main>
            <PlayerBar />
          </div>
          <TabBar unreadMessages={unreadMessages} />
        </div>
        <Toaster />
        </ListenProvider>
        </FocusProvider>
      </CommandMenuProvider>
    </TaskEditorProvider>
  );
}

/** The app's frame with grey placeholders, shown while the first screen loads. */
function ShellLoading({ sidebarCollapsed }: { sidebarCollapsed: boolean }) {
  return (
    <div className="flex min-h-dvh md:h-dvh">
      <aside className={sidebarCollapsed ? "hidden" : "hidden w-60 shrink-0 flex-col gap-4 border-r bg-sidebar px-3 py-3.5 md:flex"} aria-hidden>
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

/** When this page was made, so a copy saved on the phone knows it needs refreshing. */
function madeAt() {
  return Date.now();
}
