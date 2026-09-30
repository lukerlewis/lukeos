"use client";

import { Search, SlidersHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useCommandMenu } from "@/components/command/command-menu";
import { SEEN_EVENT } from "@/components/from-claude/mark-seen";
import { NewProjectIconButton } from "@/components/projects/project-dialog";
import { cn } from "@/lib/utils";
import { isActive, mainNav } from "./nav";

type SidebarProject = { id: string; name: string; hex: string; open: number };

export function Sidebar({ projects, newFromClaude }: { projects: SidebarProject[]; newFromClaude: number }) {
  const pathname = usePathname();
  const { openMenu } = useCommandMenu();
  // Macs use ⌘K; Windows and others Ctrl+K. Only known in the browser.
  const isMac = useSyncExternalStore(
    noSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => true,
  );
  // Opening Agent log clears the count straight away, without a reload.
  const [clearedAt, setClearedAt] = useState<number | null>(null);
  useEffect(() => {
    const clear = () => setClearedAt(newFromClaude);
    window.addEventListener(SEEN_EVENT, clear);
    return () => window.removeEventListener(SEEN_EVENT, clear);
  }, [newFromClaude]);
  const counts: Record<string, number> = { "/agent-log": clearedAt === newFromClaude ? 0 : newFromClaude };

  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-[18px] border-r bg-sidebar px-3 py-3.5 md:flex">
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground">
          L
        </span>
        <span className="font-semibold">Luke&apos;s space</span>
      </div>

      <button
        type="button"
        onClick={openMenu}
        aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
        className="flex h-9 items-center gap-2 rounded-lg border bg-card px-2.5 text-left whitespace-nowrap text-muted-foreground shadow-xs hover:text-foreground"
      >
        <Search className="size-[15px]" aria-hidden />
        <span className="grow truncate">Search</span>
        <kbd className="rounded-[5px] border bg-sidebar px-1.5 font-mono text-[11px]">{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>

      <nav className="flex flex-col gap-0.5" aria-label="Main">
        {mainNav.map((item) => (
          <NavLink key={item.href} {...item} active={isActive(pathname, item.href)} count={counts[item.href]} />
        ))}
      </nav>

      <div className="-mx-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-1">
        <div className="flex items-center justify-between px-2.5 pb-1.5 text-xs font-medium text-muted-foreground">
          <Link href="/projects" className="hover:text-foreground">
            Projects
          </Link>
          <NewProjectIconButton />
        </div>
        {projects.length === 0 && <p className="px-2.5 text-[13px] text-muted-foreground">No projects yet</p>}
        {projects.map((p) => {
          const href = `/projects/${p.id}`;
          const active = pathname === href;
          return (
            <Link
              key={p.id}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-subtle-foreground hover:bg-muted",
                active && "bg-muted font-medium text-foreground",
              )}
            >
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.hex }} aria-hidden />
              <span className="grow truncate">{p.name}</span>
              {p.open > 0 && <span className="text-xs text-muted-foreground">{p.open}</span>}
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
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 font-medium text-subtle-foreground hover:bg-muted",
        active && "bg-muted font-semibold text-foreground",
      )}
    >
      <Icon className="size-4" />
      <span className="grow">{label}</span>
      {!!count && (
        <span className="min-w-5 rounded-full bg-doing px-1.5 text-center text-[11px] leading-5 font-semibold text-white dark:text-background">
          {count}
          <span className="sr-only"> new</span>
        </span>
      )}
    </Link>
  );
}
