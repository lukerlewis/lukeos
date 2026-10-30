"use client";

import { ChevronDown, ChevronUp, Ellipsis, PanelLeftClose, PanelLeftOpen, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useCommandMenu } from "@/components/command/command-menu";
import { useFocus } from "@/components/focus/focus-provider";
import { SEEN_EVENT } from "@/components/from-claude/mark-seen";
import { useUnreadMessages } from "@/components/messages/unread";
import { PlayingBars } from "@/components/listen/header-player";
import { useListen } from "@/components/listen/listen-provider";
import { NewProjectIconButton } from "@/components/projects/project-dialog";
import { cn } from "@/lib/utils";
import { isActive, mainNav, moreNav, SIDEBAR_COOKIE } from "./nav";
import { useSectionLink } from "@/lib/places";

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
  /** Starts as a narrow strip of icons. */
  collapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
  // Animates only after a toggle, so it doesn't glide about on every page load.
  const [animate, setAnimate] = useState(false);
  const toggle = useCallback(() => {
    setAnimate(true);
    setCollapsed((c) => {
      document.cookie = `${SIDEBAR_COOKIE}=${c ? "open" : "collapsed"}; path=/; max-age=31536000; samesite=lax`;
      return !c;
    });
  }, []);
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

  // Collapsed, each icon names itself in a label beside the strip on hover or keyboard focus.
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);
  const showTip = (e: React.SyntheticEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
    if (!collapsed || !el) return setTip(null);
    const r = el.getBoundingClientRect();
    setTip({ label: el.dataset.tip!, top: r.top + r.height / 2 });
  };

  return (
    <>
      <aside
        onPointerOver={showTip}
        onPointerLeave={() => setTip(null)}
        onFocus={showTip}
        onBlur={() => setTip(null)}
        onScrollCapture={() => setTip(null)}
        onClick={() => setTip(null)}
        className={cn(
          "hidden shrink-0 flex-col gap-4 overflow-hidden border-r bg-sidebar px-3 py-3.5 md:flex",
          collapsed ? "w-[68px]" : "w-60",
          animate && "sidebar-glide",
          animate && !collapsed && "sidebar-opening",
        )}
      >
        <SidebarContents
          projects={projects}
          newFromClaude={newFromClaude}
          unreadMessages={unreadMessages}
          rail={collapsed}
          onToggle={toggle}
        />
      </aside>
      {collapsed && tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed left-[76px] z-50 -translate-y-1/2 rounded-md bg-primary px-2 py-1 text-meta whitespace-nowrap text-primary-foreground"
          style={{ top: tip.top }}
        >
          {tip.label}
        </div>
      )}
    </>
  );
}

function SidebarContents({
  projects,
  newFromClaude,
  unreadMessages,
  rail,
  onToggle,
}: {
  projects: SidebarProject[];
  newFromClaude: number;
  unreadMessages: number;
  /** Collapsed to a strip of icons. */
  rail: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const playing = !!useListen()?.playing;
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

  const toggleLabel = rail ? "Expand sidebar" : "Collapse sidebar";
  const toggleKeys = isMac ? "⌘." : "Ctrl+.";

  return (
    <>
      {rail ? (
        <button
          type="button"
          onClick={onToggle}
          data-tip={`${toggleLabel} (${toggleKeys})`}
          aria-label={toggleLabel}
          aria-keyshortcuts={isMac ? "Meta+." : "Control+."}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-icon hover:bg-muted hover:text-foreground"
        >
          <PanelLeftOpen className="size-[18px]" aria-hidden />
        </button>
      ) : (
        <div className="flex items-center gap-2.5 py-1.5 pl-2">
          <span className="flex size-7 items-center justify-center rounded-[8px] bg-primary text-meta font-medium text-primary-foreground">
            L
          </span>
          <span className="grow font-medium whitespace-nowrap text-ink">Luke&apos;s space</span>
          <button
            type="button"
            onClick={onToggle}
            title={`${toggleLabel} (${toggleKeys})`}
            aria-label={toggleLabel}
            aria-keyshortcuts={isMac ? "Meta+." : "Control+."}
            className="-my-1.5 flex size-9 items-center justify-center rounded-lg text-icon hover:bg-muted hover:text-foreground"
          >
            <PanelLeftClose className="size-[18px]" aria-hidden />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={openMenu}
        aria-label={rail ? "Search" : undefined}
        data-tip={`Search (${isMac ? "⌘K" : "Ctrl K"})`}
        aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
        className={cn(
          "pressable flex shrink-0 items-center gap-2 rounded-lg border border-stroke-strong bg-card text-left whitespace-nowrap text-muted-foreground hover:text-foreground",
          rail ? "size-11 justify-center" : "h-10 px-3",
        )}
      >
        <Search className="size-4 text-icon" aria-hidden />
        {!rail && (
          <>
            <span className="grow truncate">Search</span>
            <kbd className="rounded-md border border-stroke bg-muted px-1.5 text-xs">{isMac ? "⌘K" : "Ctrl K"}</kbd>
          </>
        )}
      </button>

      {/* The page links and projects scroll together if the window is short. */}
      <div className={cn("-mx-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-1", rail && "no-scrollbar")}>
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {mainNav.map((item) =>
            item.href === "/listen" ? (
              // While something plays, little bouncing bars sit beside Music on every page
              // (in the collapsed strip they take the place of its icon).
              <div key={item.href} className="relative">
                <NavLink {...item} icon={playing && rail ? PlayingIcon : item.icon} active={isActive(pathname, item.href)} prefetch rail={rail} />
                {playing && !rail && <PlayingBars className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2" />}
              </div>
            ) : (
              <NavLink
                key={item.href}
                {...item}
                active={isActive(pathname, item.href)}
                prefetch
                count={counts[item.href]}
                aside={item.href === "/focus" ? running : null}
                rail={rail}
              />
            ),
          )}
          <MoreNav pathname={pathname} counts={counts} rail={rail} />
        </nav>

        <div className="flex flex-col gap-0.5">
          {rail ? (
            <div className="mx-2 mb-2 border-t" aria-hidden />
          ) : (
            <div className="flex items-center justify-between px-3 pb-1 text-meta font-medium whitespace-nowrap text-muted-foreground">
              <Link href="/projects" className="hover:text-foreground">
                Projects
              </Link>
              <NewProjectIconButton />
            </div>
          )}
          {projects.length === 0 && !rail && <p className="px-3 text-meta text-muted-foreground">No projects yet</p>}
          {projects.map((p) => (
            <ProjectLink key={p.id} project={p} active={pathname === `/projects/${p.id}`} rail={rail} />
          ))}
        </div>
      </div>

      <div className="grow" />
      <div className="flex flex-col gap-0.5">
        <NavLink href="/trash" label="Trash" icon={Trash2} active={isActive(pathname, "/trash")} rail={rail} />
        <NavLink href="/settings" label="Settings" icon={SlidersHorizontal} active={isActive(pathname, "/settings")} rail={rail} />
      </div>
    </>
  );
}

/** Music's icon in the collapsed strip while something plays. */
function PlayingIcon({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center justify-center", className)}>
      <PlayingBars className="h-3.5" />
    </span>
  );
}

const noSubscribe = () => () => {};

const MORE_KEY = "lukeos_sidebar_more";
function readMoreOpen() {
  try {
    return localStorage.getItem(MORE_KEY) === "open";
  } catch {
    return false;
  }
}

/** Inspiration, Work archive, Portfolio, Agents, Messages and All tasks, folded under one row. */
function MoreNav({ pathname, counts, rail }: { pathname: string; counts: Record<string, number>; rail: boolean }) {
  const inside = moreNav.some((item) => isActive(pathname, item.href));
  // Starts open on one of its own pages, or if it was left open last time.
  const remembered = useSyncExternalStore(noSubscribe, readMoreOpen, () => false);
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? (inside || remembered);
  const toggle = () => {
    setChoice(!open);
    try {
      localStorage.setItem(MORE_KEY, open ? "closed" : "open");
    } catch {}
  };
  const total = moreNav.reduce((sum, item) => sum + (counts[item.href] ?? 0), 0);
  const highlight = !open && inside;

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={rail ? (open ? "Less" : "More") : undefined}
        data-tip={open ? "Less" : "More"}
        className={cn(
          "group pressable relative flex h-11 shrink-0 items-center gap-3 rounded-lg px-3 text-left text-control whitespace-nowrap text-muted-foreground hover:bg-muted",
          rail && "w-11",
          highlight && "bg-selected font-medium text-ink",
        )}
      >
        {rail && open ? (
          <ChevronUp className="size-[18px] text-icon" aria-hidden />
        ) : (
          <Ellipsis className={cn("size-[18px]", highlight ? "text-foreground" : "text-icon")} aria-hidden />
        )}
        {!rail && <span className="grow">More</span>}
        {!open && total > 0 && <Count n={total} rail={rail} />}
        {!rail && <ChevronDown className={cn("size-4 text-icon transition-transform", open && "rotate-180")} aria-hidden />}
      </button>
      {open && (
        <div className={cn("flex flex-col gap-0.5", !rail && "pl-3")}>
          {moreNav.map((item) => (
            <NavLink key={item.href} {...item} active={isActive(pathname, item.href)} count={counts[item.href]} rail={rail} />
          ))}
        </div>
      )}
    </>
  );
}

/** A red count badge: at the end of a row, or on the icon's corner in the collapsed strip. */
function Count({ n, rail }: { n: number; rail: boolean }) {
  return (
    <span
      className={cn(
        "min-w-5 rounded-full bg-notification px-1.5 text-center text-xs leading-5 font-medium text-on-notification",
        rail && "absolute top-0.5 right-0.5 min-w-4 px-1 text-[10px] leading-4",
      )}
    >
      {n}
      <span className="sr-only"> new</span>
    </span>
  );
}

function ProjectLink({ project: p, active, rail }: { project: SidebarProject; active: boolean; rail: boolean }) {
  const link = useSectionLink(`/projects/${p.id}`, `/projects/${p.id}`, active);
  return (
    <Link
      {...link}
      aria-current={active ? "page" : undefined}
      aria-label={rail ? p.name : undefined}
      data-tip={p.name}
      className={cn(
        "pressable flex h-11 shrink-0 items-center gap-3 rounded-lg px-3 text-control whitespace-nowrap text-muted-foreground hover:bg-muted",
        rail && "w-11",
        active && "bg-selected font-medium text-ink",
      )}
    >
      <span className="flex size-[18px] shrink-0 items-center justify-center" aria-hidden>
        <span className="size-2.5 rounded-[3px]" style={{ background: p.hex }} />
      </span>
      {!rail && (
        <>
          <span className="grow truncate">{p.name}</span>
          {p.open > 0 && <span className="text-meta text-muted-foreground">{p.open}</span>}
        </>
      )}
    </Link>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  count,
  aside,
  prefetch,
  rail = false,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  count?: number;
  /** Quiet text at the end of the row, e.g. a running timer. */
  aside?: string | null;
  /** Load the whole screen ahead of time, so opening it is instant. For the main screens. */
  prefetch?: boolean;
  /** Icon only, in the collapsed strip. */
  rail?: boolean;
}) {
  // Coming back to a section opens the page Luke was last on there.
  const link = useSectionLink(href, href, active);
  return (
    <Link
      {...link}
      prefetch={prefetch || null}
      aria-current={active ? "page" : undefined}
      aria-label={rail ? label : undefined}
      data-tip={aside ? `${label} · ${aside}` : label}
      className={cn(
        "group pressable relative flex h-11 shrink-0 items-center gap-3 rounded-lg px-3 text-control whitespace-nowrap text-muted-foreground hover:bg-muted",
        rail && "w-11",
        active && "bg-selected font-medium text-ink",
      )}
    >
      <Icon className={cn("size-[18px] shrink-0", active ? "text-foreground" : "text-icon")} aria-hidden />
      {!rail && <span className="grow">{label}</span>}
      {aside && !rail && <span className="text-meta text-muted-foreground tabular-nums">{aside}</span>}
      {aside && rail && <span className="absolute top-2 right-2 size-1.5 rounded-full bg-foreground" aria-hidden />}
      {!!count && <Count n={count} rail={rail} />}
    </Link>
  );
}
