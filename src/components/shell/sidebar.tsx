"use client";

import { PanelLeftClose, PanelLeftOpen, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useCommandMenu } from "@/components/command/command-menu";
import { useFocus } from "@/components/focus/focus-provider";
import { SEEN_EVENT } from "@/components/from-claude/mark-seen";
import { useUnreadMessages } from "@/components/messages/unread";
import { NewProjectIconButton } from "@/components/projects/project-dialog";
import { cn } from "@/lib/utils";
import { isActive, mainNav, SIDEBAR_COOKIE } from "./nav";

type SidebarProject = { id: string; name: string; hex: string; open: number };

export function Sidebar({
  projects,
  newFromClaude,
  unreadMessages,
  collapsed: startCollapsed = false,
}: {
  projects: SidebarProject[];
  newFromClaude: number;
  unreadMessages: number;
  /** Starts hidden off the left edge. */
  collapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
  // Animates only after a toggle, so it doesn't slide about on every page load.
  const [animate, setAnimate] = useState(false);
  // While collapsed it's hidden off the left edge, and slides out over the page
  // when the pointer reaches that edge, like the Mac's Dock.
  const [peek, setPeek] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const show = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    setPeek(true);
  }, []);
  const hideSoon = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setPeek(false), 300);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
  const toggle = useCallback(() => {
    // Pinning it while it's slid out keeps it where it is, so no animation.
    setAnimate(!peek);
    setPeek(false);
    setCollapsed((c) => {
      document.cookie = `${SIDEBAR_COOKIE}=${c ? "open" : "collapsed"}; path=/; max-age=31536000; samesite=lax`;
      return !c;
    });
  }, [peek]);
  // Cmd+. (Ctrl+. elsewhere) collapses or expands it from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "." && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const contents = (
    <SidebarContents
      projects={projects}
      newFromClaude={newFromClaude}
      unreadMessages={unreadMessages}
      pinned={!collapsed}
      onToggle={toggle}
    />
  );

  if (!collapsed)
    return (
      <aside
        className={cn(
          "hidden w-60 shrink-0 flex-col gap-4 overflow-hidden border-r bg-sidebar px-3 py-3.5 md:flex",
          animate && "sidebar-opening",
        )}
      >
        {contents}
      </aside>
    );

  return (
    <>
      {/* Closes up the space the sidebar left, rather than the page jumping. */}
      {animate && <div className="sidebar-closing hidden w-0 shrink-0 md:block" aria-hidden />}
      <div className="fixed inset-y-0 left-0 z-40 hidden w-2 md:block" onMouseEnter={show} onClick={show} aria-hidden />
      <aside
        inert={!peek}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        className={cn(
          "sidebar-float fixed inset-y-0 left-0 z-50 hidden w-60 flex-col gap-4 border-r bg-sidebar px-3 py-3.5 md:flex",
          !peek && "-translate-x-full",
          animate && "sidebar-slide-away",
        )}
      >
        {contents}
      </aside>
    </>
  );
}

function SidebarContents({
  projects,
  newFromClaude,
  unreadMessages,
  pinned,
  onToggle,
}: {
  projects: SidebarProject[];
  newFromClaude: number;
  unreadMessages: number;
  /** In place beside the page, rather than slid out over it. */
  pinned: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const { openMenu } = useCommandMenu();
  // Macs use ⌘K; Windows and others Ctrl+K. Only known in the browser.
  const isMac = useSyncExternalStore(
    noSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => true,
  );
  // Opening Documents clears Claude's New count straight away, without a reload.
  const [clearedAt, setClearedAt] = useState<number | null>(null);
  useEffect(() => {
    const clear = () => setClearedAt(newFromClaude);
    window.addEventListener(SEEN_EVENT, clear);
    return () => window.removeEventListener(SEEN_EVENT, clear);
  }, [newFromClaude]);
  const unread = useUnreadMessages(unreadMessages);
  const running = useFocus()?.runningClock;
  const counts: Record<string, number> = {
    "/documents": clearedAt === newFromClaude ? 0 : newFromClaude,
    "/messages": unread,
  };

  const toggleLabel = pinned ? "Collapse sidebar" : "Keep sidebar open";

  return (
    <>
      <div className="flex items-center gap-2.5 py-1.5 pl-2">
        <span className="flex size-7 items-center justify-center rounded-[8px] bg-primary text-meta font-medium text-primary-foreground">
          L
        </span>
        <span className="grow font-medium text-ink">Luke&apos;s space</span>
        <button
          type="button"
          onClick={onToggle}
          title={`${toggleLabel} (${isMac ? "⌘." : "Ctrl+."})`}
          aria-label={toggleLabel}
          aria-keyshortcuts={isMac ? "Meta+." : "Control+."}
          className="-my-1.5 flex size-9 items-center justify-center rounded-lg text-icon hover:bg-muted hover:text-foreground"
        >
          {pinned ? <PanelLeftClose className="size-[18px]" aria-hidden /> : <PanelLeftOpen className="size-[18px]" aria-hidden />}
        </button>
      </div>

      <button
        type="button"
        onClick={openMenu}
        aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
        className="pressable flex h-10 items-center gap-2 rounded-lg border border-stroke-strong bg-card px-3 text-left whitespace-nowrap text-muted-foreground hover:text-foreground"
      >
        <Search className="size-4 text-icon" aria-hidden />
        <span className="grow truncate">Search</span>
        <kbd className="rounded-md border border-stroke bg-muted px-1.5 text-xs">{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>

      <nav className="flex flex-col gap-0.5" aria-label="Main">
        {mainNav.map((item) => (
          <NavLink key={item.href} {...item} active={isActive(pathname, item.href)} count={counts[item.href]}
            aside={item.href === "/focus" ? running : null}
          />
        ))}
      </nav>

      <div className="-mx-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-1">
        <div className="flex items-center justify-between px-3 pb-1 text-meta font-medium text-muted-foreground">
          <Link href="/projects" className="hover:text-foreground">
            Projects
          </Link>
          <NewProjectIconButton />
        </div>
        {projects.length === 0 && <p className="px-3 text-meta text-muted-foreground">No projects yet</p>}
        {projects.map((p) => {
          const href = `/projects/${p.id}`;
          const active = pathname === href;
          return (
            <Link
              key={p.id}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "pressable flex h-11 items-center gap-3 rounded-lg px-3 text-control text-muted-foreground hover:bg-muted",
                active && "bg-selected font-medium text-ink",
              )}
            >
              <span className="flex size-[18px] shrink-0 items-center justify-center" aria-hidden>
                <span className="size-2.5 rounded-[3px]" style={{ background: p.hex }} />
              </span>
              <span className="grow truncate">{p.name}</span>
              {p.open > 0 && <span className="text-meta text-muted-foreground">{p.open}</span>}
            </Link>
          );
        })}
      </div>

      <div className="grow" />
      <div className="flex flex-col gap-0.5">
        <NavLink href="/trash" label="Trash" icon={Trash2} active={isActive(pathname, "/trash")} />
        <NavLink href="/settings" label="Settings" icon={SlidersHorizontal} active={isActive(pathname, "/settings")} />
      </div>
    </>
  );
}

const noSubscribe = () => () => {};

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  count,
  aside,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  count?: number;
  /** Quiet text at the end of the row, e.g. a running timer. */
  aside?: string | null;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group pressable flex h-11 items-center gap-3 rounded-lg px-3 text-control text-muted-foreground hover:bg-muted",
        active && "bg-selected font-medium text-ink",
      )}
    >
      <Icon className={cn("size-[18px]", active ? "text-foreground" : "text-icon")} aria-hidden />
      <span className="grow">{label}</span>
      {aside && <span className="text-meta text-muted-foreground tabular-nums">{aside}</span>}
      {!!count && (
        <span className="min-w-5 rounded-full bg-notification px-1.5 text-center text-xs leading-5 font-medium text-on-notification">
          {count}
          <span className="sr-only"> new</span>
        </span>
      )}
    </Link>
  );
}
