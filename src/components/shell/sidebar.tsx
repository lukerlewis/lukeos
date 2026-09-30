"use client";

import { Plus, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActive, mainNav } from "./nav";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-[18px] border-r bg-sidebar px-3 py-3.5 md:flex">
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground">
          L
        </span>
        <span className="font-semibold">Luke&apos;s space</span>
      </div>

      <div
        className="flex h-9 items-center gap-2 rounded-lg border bg-card px-2.5 whitespace-nowrap text-muted-foreground shadow-xs"
        title="Search arrives in a later step"
      >
        <Search className="size-[15px]" aria-hidden />
        <span className="grow truncate">Search or run a command</span>
        <kbd className="rounded-[5px] border bg-sidebar px-1.5 font-mono text-[11px]">⌘K</kbd>
      </div>

      <nav className="flex flex-col gap-0.5" aria-label="Main">
        {mainNav.map((item) => (
          <NavLink key={item.href} {...item} active={isActive(pathname, item.href)} />
        ))}
      </nav>

      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between px-2.5 pb-1.5 text-xs font-medium text-muted-foreground">
          <span>Projects</span>
          <button
            type="button"
            disabled
            aria-label="New project (coming in step 2)"
            title="Coming in step 2"
            className="flex text-muted-foreground disabled:opacity-60"
          >
            <Plus className="size-[15px]" aria-hidden />
          </button>
        </div>
        <p className="px-2.5 text-[13px] text-muted-foreground">No projects yet</p>
      </div>

      <div className="grow" />
      <NavLink href="/settings" label="Settings" icon={SlidersHorizontal} active={isActive(pathname, "/settings")} />
    </aside>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
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
    </Link>
  );
}
