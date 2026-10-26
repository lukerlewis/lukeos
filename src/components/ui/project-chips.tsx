import Link from "next/link";
import { colorHex } from "@/lib/project-colors";
import { cn } from "@/lib/utils";

const chip = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-meta whitespace-nowrap";
const onClass = "bg-selected font-medium text-ink";
const offClass = "border bg-card text-muted-foreground hover:bg-muted";

export type ChipProject = { id: string; name: string; hex: string };

/**
 * Chips to show only some projects' things, the same as on the dashboard: "All" plus one chip per project with
 * its count; tap several to show them together. Projects with nothing here stay out of the way.
 * Pass `onPick` to keep the choice in the page, or `href` to keep it in the address (for server pages).
 */
export function ProjectChips({
  projects,
  counts,
  total,
  picked,
  allLabel = "All",
  label = "Projects",
  onPick,
  href,
  className,
}: {
  projects: ChipProject[];
  /** How many things each project has here, by id. */
  counts: Record<string, number>;
  total: number;
  picked: string[];
  allLabel?: string;
  label?: string;
  onPick?: (ids: string[]) => void;
  href?: (ids: string[]) => string;
  className?: string;
}) {
  const chips = projects.filter((p) => picked.includes(p.id) || (counts[p.id] ?? 0) > 0);
  if (chips.length === 0) return null;
  const all = picked.length === 0;

  const chipFor = (key: string, ids: string[], on: boolean, children: React.ReactNode) =>
    href ? (
      <Link key={key} href={href(ids)} scroll={false} aria-current={on || undefined} className={cn(chip, on ? onClass : offClass)}>
        {children}
      </Link>
    ) : (
      <button key={key} type="button" aria-pressed={on} onClick={() => onPick?.(ids)} className={cn(chip, on ? onClass : offClass)}>
        {children}
      </button>
    );

  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {chipFor(
        "all",
        [],
        all,
        <>
          {allLabel}
          <span className="text-muted-foreground">{total}</span>
        </>,
      )}
      {chips.map((p) => {
        const on = picked.includes(p.id);
        return chipFor(
          p.id,
          on ? picked.filter((id) => id !== p.id) : [...picked, p.id],
          on,
          <>
            <span className="size-2 rounded-[3px]" style={{ background: p.hex }} aria-hidden />
            {p.name}
            <span className="text-muted-foreground">{counts[p.id] ?? 0}</span>
          </>,
        );
      })}
    </div>
  );
}

/** Projects for the chips, from listProjects. */
export function chipProjects(projects: { id: string; name: string; color: string }[]): ChipProject[] {
  return projects.map((p) => ({ id: p.id, name: p.name, hex: colorHex(p.color) }));
}

/** The projects picked in the address (`?project=id,id`), keeping only ones that still exist. */
export function pickedFromQuery(value: string | string[] | undefined, projects: { id: string }[]) {
  const raw = (Array.isArray(value) ? value.join(",") : value ?? "").split(",");
  return raw.filter((id) => projects.some((p) => p.id === id));
}

/** How many things each project has. */
export function countByProject(projectIds: (string | null | undefined)[]) {
  const counts: Record<string, number> = {};
  for (const id of projectIds) if (id) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

/** Sets or clears `?project=` on a page's address, keeping its other settings. */
export function withProjects(path: string, params: Record<string, string | undefined>, ids: string[]) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && k !== "project") search.set(k, v);
  if (ids.length) search.set("project", ids.join(","));
  const s = search.toString();
  return s ? `${path}?${s}` : path;
}
