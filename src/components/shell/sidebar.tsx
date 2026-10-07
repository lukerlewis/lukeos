"use client";

import { Search, SlidersHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useCommandMenu } from "@/components/command/command-menu";
import { useFocus } from "@/components/focus/focus-provider";
import { SEEN_EVENT } from "@/components/from-claude/mark-seen";
import { useUnreadMessages } from "@/components/messages/unread";
import { NewProjectIconButton } from "@/components/projects/project-dialog";
import { cn } from "@/lib/utils";
import { isActive, mainNav } from "./nav";

type SidebarProject = { id: string; name: string; hex: string; open: number };

export function Sidebar({
  projects,
  newFromClaude,
  unreadMessages,
}: {
  projects: SidebarProject[];
  newFromClaude: number;
  unreadMessages: number;
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

  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-4 border-r bg-sidebar px-3 py-3.5 md:flex">
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <span className="flex size-7 items-center justify-center rounded-[8px] bg-primary text-meta font-medium text-primary-foreground">
          L
        </span>
        <span className="font-medium text-ink">Luke&apos;s space</span>
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
