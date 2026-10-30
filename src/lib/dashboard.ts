/**
 * How the dashboard is laid out and which tasks it shows. Shared by the
 * dashboard screen and the get_dashboard / set_dashboard_view operations, so
 * Luke and Claude see the same thing.
 */
import { statuses, type Status } from "./task-fields";

/** What the Today list and Board columns are sorted by, and which way round. */
export const sortKeys = ["priority", "effort", "project", "name", "created"] as const;
export type SortKey = (typeof sortKeys)[number];
export const sortDirs = ["desc", "asc"] as const;
export type SortDir = (typeof sortDirs)[number];
export const sortLabel: Record<SortKey, string> = {
  priority: "Priority",
  effort: "Focus type",
  project: "Project",
  name: "Name",
  created: "Date added",
};
/** The two ways round, in words that fit the key. "desc" is the first one. */
export const sortDirLabel: Record<SortKey, Record<SortDir, string>> = {
  priority: { desc: "High to low", asc: "Low to high" },
  effort: { desc: "Deep work first", asc: "Shallow first" },
  project: { desc: "Z to A", asc: "A to Z" },
  name: { desc: "Z to A", asc: "A to Z" },
  created: { desc: "Newest first", asc: "Oldest first" },
};
/** One level of sorting. */
export type SortRule = { by: SortKey; dir: SortDir };
/** Sorts in order of importance: ties on the first are broken by the second, and so on. Empty means the usual order. */
export type DashboardSort = SortRule[];
/** Which way round a newly added sort starts: A to Z for names, high or newest first for the rest. */
export const defaultSortDir = (by: SortKey): SortDir => (by === "name" || by === "project" ? "asc" : "desc");
/** How a sort reads on its button: the field when there's one, "2 sorts" when there are more. */
export function sortSummary(sort: DashboardSort): string {
  if (sort.length === 0) return "Sort";
  if (sort.length === 1) return sortLabel[sort[0].by];
  return `${sort.length} sorts`;
}

export const dashboardLayouts = ["list", "board"] as const;
export type DashboardLayout = (typeof dashboardLayouts)[number];

export type DashboardView = {
  /**
   * "list" is the Today tab: just the tasks in the Today list.
   * "board" is every task in columns by list (Today, Tomorrow, This week, Later).
   */
  layout: DashboardLayout;
  /** Which statuses to show. Starts with To do and Doing, so finished tasks are hidden. */
  show: Status[];
  /** How the Today list and Board columns are sorted, most important first. */
  sort: DashboardSort;
};

export const defaultDashboardView: DashboardView = {
  layout: "list",
  show: ["todo", "doing"],
  sort: [{ by: "priority", dir: "desc" }],
};

/** Reads a saved view, falling back to the default for anything missing or unknown. */
export function parseDashboardView(raw: unknown): DashboardView {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const layout = dashboardLayouts.find((l) => l === v.layout) ?? defaultDashboardView.layout;
  const show = Array.isArray(v.show) ? statuses.filter((s) => v.show && (v.show as unknown[]).includes(s)) : [];
  return {
    layout,
    show: show.length ? show : defaultDashboardView.show,
    sort: parseSort(v.sort),
  };
}

/** Reads saved sorts, each field once. A single sort saved before there could be several still reads. */
function parseSort(raw: unknown): DashboardSort {
  if (raw === undefined || raw === null) return defaultDashboardView.sort;
  const list = Array.isArray(raw) ? raw : [raw];
  const rules: SortRule[] = [];
  for (const item of list) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const by = sortKeys.find((k) => k === r.by);
    if (!by || rules.some((x) => x.by === by)) continue;
    rules.push({ by, dir: sortDirs.find((d) => d === r.dir) ?? defaultSortDir(by) });
  }
  return rules;
}
