"use client";

import { PanelLeftClose, PanelLeftOpen, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
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
  /** Starts as a slim row of icons. */
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(startCollapsed);
  // Only animates after a toggle, so it doesn't slide in on every page load.
  const [toggled, setToggled] = useState(false);
  const toggle = useCallback(() => {
    setToggled(true);
    setCollapsed((c) => {
      document.cookie = `${SIDEBAR_COOKIE}=${c ? "open" : "collapsed"}; path=/; max-age=31536000; samesite=lax`;
      return !c;
    });
  }, []);
  // Cmd+\ (Ctrl+\ elsewhere) collapses or expands it from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "\\" && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
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

  const shortcut = isMac ? "⌘\\" : "Ctrl+\\";

  if (collapsed)
    return (
      <aside
        className={cn(
          "hidden w-16 shrink-0 flex-col items-center gap-4 overflow-hidden border-r bg-sidebar px-2 py-3.5 md:flex",
          toggled && "sidebar-closing",
        )}
      >
        <button
          type="button"
          onClick={toggle}
          title={`Expand sidebar (${shortcut})`}
          aria-label="Expand sidebar"
          aria-keyshortcuts={isMac ? "Meta+\\" : "Control+\\"}
          className="group relative flex size-10 items-center justify-center rounded-lg hover:bg-muted"
        >
          <span className="flex size-7 items-center justify-center rounded-[8px] bg-primary text-meta font-medium text-primary-foreground group-hover:hidden">
            L
          </span>
          <PanelLeftOpen className="hidden size-[18px] text-icon group-hover:block" aria-hidden />
        </button>

        <button
          type="button"
          onClick={openMenu}
          title={`Search (${isMac ? "⌘K" : "Ctrl K"})`}
          aria-label="Search"
          className="flex size-10 items-center justify-center rounded-lg border border-stroke-strong bg-card text-icon hover:text-foreground"
        >
          <Search className="size-4" aria-hidden />
        </button>

        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {mainNav.map((item) => (
            <RailLink key={item.href} {...item} active={isActive(pathname, item.href)} count={counts[item.href]} />
          ))}
        </nav>

        <div className="-mx-1 flex min-h-0 flex-col items-center gap-0.5 overflow-y-auto px-1">
          {projects.map((p) => {
            const href = `/projects/${p.id}`;
            const active = pathname === href;
            return (
              <Link
                key={p.id}
                href={href}
                title={p.name}
                aria-label={p.name}
                aria-current={active ? "page" : undefined}
                className={cn("pressable flex size-11 items-center justify-center rounded-lg hover:bg-muted", active && "bg-selected")}
              >
                <span className="size-2.5 rounded-[3px]" style={{ background: p.hex }} aria-hidden />
              </Link>
            );
          })}
        </div>

        <div className="grow" />
        <div className="flex flex-col gap-0.5">
          <RailLink href="/trash" label="Trash" icon={Trash2} active={isActive(pathname, "/trash")} />
          <RailLink href="/settings" label="Settings" icon={SlidersHorizontal} active={isActive(pathname, "/settings")} />
        </div>
      </aside>
    );

  return (
    <aside
      className={cn(
        "hidden w-60 shrink-0 flex-col gap-4 overflow-hidden border-r bg-sidebar px-3 py-3.5 md:flex",
        toggled && "sidebar-opening",
      )}
    >
      <div className="flex items-center gap-2.5 py-1.5 pl-2">
        <span className="flex size-7 items-center justify-center rounded-[8px] bg-primary text-meta font-medium text-primary-foreground">
          L
        </span>
        <span className="grow font-medium text-ink">Luke&apos;s space</span>
        <button
          type="button"
          onClick={toggle}
          title={`Collapse sidebar (${shortcut})`}
          aria-label="Collapse sidebar"
          aria-keyshortcuts={isMac ? "Meta+\\" : "Control+\\"}
          className="-my-1.5 flex size-9 items-center justify-center rounded-lg text-icon hover:bg-muted hover:text-foreground"
        >
          <PanelLeftClose className="size-[18px]" aria-hidden />
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
    </aside>
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

/** A sidebar row as just its icon, with its name on hover. */
function RailLink({
  href,
  label,
  icon: Icon,
  active,
  count,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  count?: number;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={count ? `${label}, ${count} new` : label}
      aria-current={active ? "page" : undefined}
      className={cn("pressable relative flex size-11 items-center justify-center rounded-lg hover:bg-muted", active && "bg-selected")}
    >
      <Icon className={cn("size-[18px]", active ? "text-foreground" : "text-icon")} aria-hidden />
      {!!count && <span className="absolute top-2 right-2 size-2 rounded-full bg-notification" aria-hidden />}
    </Link>
  );
}
