"use client";

import {
  Archive,
  Lightbulb,
  CheckSquare,
  CornerDownLeft,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Globe,
  Package,
  Monitor,
  Moon,
  Plus,
  Search,
  SlidersHorizontal,
  Bot,
  LayoutDashboard,
  Sun,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectDialog } from "@/components/projects/project-dialog";
import { ClaudeBadge } from "@/components/tasks/made-by";
import { StatusIcon } from "@/components/tasks/status-circle";
import { useTaskEditor } from "@/components/tasks/task-editor";
import { Dialog } from "@/components/ui/dialog";
import type { SearchResult } from "@/core/search";
import { friendlyDay } from "@/lib/dates";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";

export type MenuProject = { id: string; name: string; hex: string };

type Menu = {
  /** Open the search and commands box. */
  openMenu: () => void;
  /** Open the New project form. */
  newProject: () => void;
};

const MenuContext = createContext<Menu | null>(null);

export function useCommandMenu() {
  const menu = use(MenuContext);
  if (!menu) throw new Error("useCommandMenu must be used inside <CommandMenuProvider>");
  return menu;
}

/**
 * The search and commands box, opened with ⌘K (Ctrl+K on Windows) or the
 * sidebar's search bar. The phone's Search tab shows the same thing as a page.
 */
export function CommandMenuProvider({
  projects,
  today,
  children,
}: {
  projects: MenuProject[];
  today: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Not on top of another open window, such as the task editor.
        if (!document.querySelector("dialog[open]") || open) setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const menu = useMemo<Menu>(() => ({ openMenu: () => setOpen(true), newProject: () => setProjectOpen(true) }), []);

  return (
    <MenuContext value={menu}>
      <MenuData value={{ projects, today }}>
        {children}
        {open && (
          <Dialog
            label="Search and commands"
            onClose={() => setOpen(false)}
            className="sm:mt-[12vh] sm:mb-auto sm:max-w-xl"
          >
            <CommandPanel onDone={() => setOpen(false)} />
          </Dialog>
        )}
        {projectOpen && <ProjectDialog onClose={() => setProjectOpen(false)} />}
      </MenuData>
    </MenuContext>
  );
}

const DataContext = createContext<{ projects: MenuProject[]; today: string }>({ projects: [], today: "" });
const MenuData = DataContext.Provider;

type Item = {
  key: string;
  group: string;
  label: string;
  icon?: LucideIcon;
  /** Shown instead of an icon, e.g. a project's colour. */
  lead?: React.ReactNode;
  detail?: React.ReactNode;
  /** Extra words that should find this command. */
  keywords?: string;
  run: () => void | Promise<void>;
};

const pages: { href: string; label: string; icon: LucideIcon; keywords?: string }[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, keywords: "home today due board kanban" },
  { href: "/tasks", label: "All tasks", icon: CheckSquare, keywords: "list" },
  { href: "/notes", label: "Notes", icon: FileText, keywords: "pages documents" },
  { href: "/inspiration", label: "Inspiration", icon: Lightbulb, keywords: "mymind gallery moodboard pictures images references ideas" },
  { href: "/archive", label: "Work archive", icon: Archive, keywords: "portfolio case studies wins stories career" },
  { href: "/agents", label: "Agents", icon: Bot, keywords: "ai claude routines made activity from" },
  { href: "/projects", label: "Projects", icon: Folder },
  { href: "/trash", label: "Trash", icon: Trash2, keywords: "deleted bin restore" },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal, keywords: "devices passkeys connector appearance" },
];

function matches(text: string, words: string[]) {
  const t = text.toLowerCase();
  return words.every((w) => t.includes(w));
}

/**
 * A search box with commands and results under it. Arrow keys move, Enter
 * picks. `onDone` runs after something is picked (the box closes).
 */
export function CommandPanel({ onDone, autoFocus = true }: { onDone?: () => void; autoFocus?: boolean }) {
  const router = useRouter();
  const { projects, today } = use(DataContext);
  const { newTask, openTask } = useTaskEditor();
  const { newProject } = useCommandMenu();
  const { setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = query.trim();

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Ask the server a moment after typing stops; ignore answers to older text.
  const latest = useRef(0);
  useEffect(() => {
    if (!q) return;
    const n = ++latest.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await op("search", { query: q, limit: 30 });
        if (n === latest.current) setResults(found);
      } catch {
        if (n === latest.current) setResults([]);
      } finally {
        if (n === latest.current) setSearching(false);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [q]);

  const go = useCallback(
    (href: string) => {
      router.push(href);
      onDone?.();
    },
    [router, onDone],
  );

  const items = useMemo<Item[]>(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const create: Item[] = [
      {
        key: "new-task",
        group: "Create",
        label: q ? `New task “${q}”` : "New task",
        icon: Plus,
        keywords: "add todo",
        run: () => {
          onDone?.();
          newTask(q ? { title: q } : undefined);
        },
      },
      {
        key: "new-note",
        group: "Create",
        label: q ? `New note “${q}”` : "New note",
        icon: FilePlus,
        keywords: "add page document write",
        run: async () => {
          const note = await op("create_note", { title: q || undefined });
          go(`/notes/${note.id}?new=1`);
        },
      },
      {
        key: "new-project",
        group: "Create",
        label: "New project",
        icon: FolderPlus,
        keywords: "add folder",
        run: () => {
          onDone?.();
          newProject();
        },
      },
    ];
    const goTo: Item[] = pages.map((p) => ({
      key: `go-${p.href}`,
      group: "Go to",
      label: p.label,
      icon: p.icon,
      keywords: p.keywords,
      run: () => go(p.href),
    }));
    const projectItems: Item[] = projects.map((p) => ({
      key: `project-${p.id}`,
      group: "Projects",
      label: p.name,
      lead: <span className="size-2.5 rounded-[3px]" style={{ background: p.hex }} aria-hidden />,
      run: () => go(`/projects/${p.id}`),
    }));
    const appearance: Item[] = [
      { key: "theme-light", label: "Light mode", icon: Sun, value: "light" },
      { key: "theme-dark", label: "Dark mode", icon: Moon, value: "dark" },
      { key: "theme-system", label: "Match my device (light or dark)", icon: Monitor, value: "system" },
    ].map(({ value, ...t }) => ({
      ...t,
      group: "Appearance",
      keywords: "theme appearance colour color",
      run: () => {
        setTheme(value);
        onDone?.();
      },
    }));

    if (!q) return [...create, ...goTo, ...projectItems, ...appearance];

    const commandMatches = [...goTo, ...projectItems, ...appearance].filter((i) =>
      matches(`${i.label} ${i.keywords ?? ""}`, words),
    );
    const found: Item[] = (results ?? [])
      .filter((r) => r.type !== "project") // projects are already matched above
      .map((r) => resultItem(r, today, { go, openTask, onDone }));
    // The create commands only when the words aren't a command's name.
    const createMatches = create.filter((i) => i.key !== "new-project" || matches(`${i.label} ${i.keywords}`, words));
    return [...commandMatches, ...found, ...createMatches];
  }, [q, results, projects, today, go, newTask, newProject, openTask, onDone, setTheme]);

  // Keep the highlighted row in range and in view.
  const current = Math.min(active, Math.max(items.length - 1, 0));
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  async function pick(item: Item) {
    setError(null);
    try {
      await item.run();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((current + 1) % Math.max(items.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current - 1 + items.length) % Math.max(items.length, 1));
    } else if (e.key === "Enter" && items[current]) {
      e.preventDefault();
      void pick(items[current]);
    }
  }

  let lastGroup = "";
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2.5 border-b px-4">
        <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            if (!e.target.value.trim()) setResults(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search, or type a command"
          aria-label="Search, or type a command"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-list"
          aria-activedescendant={items[current] ? `command-${current}` : undefined}
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-13 min-w-0 grow bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        {searching && <span className="text-xs text-muted-foreground">Searching…</span>}
      </div>

      {error && (
        <p role="alert" className="border-b px-4 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}

      <div ref={listRef} id="command-list" role="listbox" className="max-h-[min(60dvh,26rem)] overflow-y-auto p-1.5 max-sm:max-h-none">
        {q && results && !searching && results.filter((r) => r.type !== "project").length === 0 && (
          <p className="px-3 pt-2.5 pb-1 text-[13px] text-muted-foreground">Nothing in your tasks or notes matches “{q}”.</p>
        )}
        {items.map((item, i) => {
          const header = item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          const Icon = item.icon;
          return (
            <div key={item.key}>
              {header && <div className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">{header}</div>}
              <div
                id={`command-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === current}
                onMouseMove={() => i !== current && setActive(i)}
                onClick={() => void pick(item)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[15px] md:min-h-10 md:text-sm",
                  // Touch screens have no arrow keys, so no resting highlight there.
                  i === current && "bg-muted pointer-coarse:bg-transparent",
                  "pointer-coarse:active:bg-muted",
                )}
              >
                <span className="flex size-[18px] shrink-0 items-center justify-center text-muted-foreground">
                  {item.lead ?? (Icon && <Icon className="size-4" aria-hidden />)}
                </span>
                <span className="flex min-w-0 grow flex-col">
                  <span className="truncate">{item.label}</span>
                  {item.detail && <span className="truncate text-xs text-muted-foreground">{item.detail}</span>}
                </span>
                {i === current && (
                  <CornerDownLeft className="hidden size-3.5 shrink-0 text-muted-foreground md:block" aria-hidden />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground md:flex">
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move
        </span>
        <span>
          <Kbd>Enter</Kbd> to open
        </span>
        <span>
          <Kbd>Esc</Kbd> to close
        </span>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-[5px] border bg-muted px-1.5 font-mono text-[11px]">{children}</kbd>;
}

/** A task, note or artifact found by searching, as a row. */
function resultItem(
  r: SearchResult,
  today: string,
  actions: {
    go: (href: string) => void;
    openTask: ReturnType<typeof useTaskEditor>["openTask"];
    onDone?: () => void;
  },
): Item {
  const meta = (
    <span className="inline-flex items-center gap-2">
      <ClaudeBadge madeBy={r.madeBy} />
      {r.project && (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[3px]" style={{ background: r.project.hex }} aria-hidden />
          {r.project.name}
        </span>
      )}
      {r.dueDate && r.status !== "done" && <span>{friendlyDay(r.dueDate, today)}</span>}
      {r.status === "done" && <span>Done</span>}
    </span>
  );
  const hasMeta = r.madeBy.kind === "agent" || r.project || r.dueDate || r.status === "done";
  const detail = r.snippet ?? (hasMeta ? meta : null);

  if (r.type === "task") {
    return {
      key: `task-${r.id}`,
      group: "Tasks",
      label: r.title,
      lead: <StatusIcon status={r.status ?? "todo"} className="size-[18px]" />,
      detail,
      run: async () => {
        const task = await op("get_task", { id: r.id });
        actions.onDone?.();
        actions.openTask(task);
      },
    };
  }
  if (r.type === "inspiration") {
    return {
      key: `inspiration-${r.id}`,
      group: "Inspiration",
      label: r.title,
      icon: Lightbulb,
      detail,
      run: () => actions.go(`/inspiration?item=${r.id}`),
    };
  }
  if (r.type === "entry") {
    return {
      key: `entry-${r.id}`,
      group: "Work archive",
      label: r.title,
      icon: Archive,
      detail,
      run: () => actions.go(`/archive/${r.id}`),
    };
  }
  if (r.type === "artifact") {
    return {
      key: `artifact-${r.id}`,
      group: "Artifacts",
      label: r.title,
      icon: Package,
      detail,
      run: () => actions.go(`/artifacts/${r.id}`),
    };
  }
  const Icon = r.format === "html" ? Globe : FileText;
  return {
    key: `note-${r.id}`,
    group: "Notes",
    label: r.title,
    icon: Icon,
    detail,
    run: () => actions.go(`/notes/${r.id}`),
  };
}
