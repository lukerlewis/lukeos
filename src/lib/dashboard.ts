/**
 * How the dashboard is laid out and which tasks it shows. Shared by the
 * dashboard screen and the get_dashboard / set_dashboard_view operations, so
 * Luke and Claude see the same thing.
 */
import { statuses, type Status } from "./task-fields";

/** What the Today list is sorted by, and which way round. */
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
export type DashboardSort = { by: SortKey; dir: SortDir };

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
  /** How the Today list is sorted. */
  sort: DashboardSort;
};

export const defaultDashboardView: DashboardView = {
  layout: "list",
  show: ["todo", "doing"],
  sort: { by: "priority", dir: "desc" },
};

/** Reads a saved view, falling back to the default for anything missing or unknown. */
export function parseDashboardView(raw: unknown): DashboardView {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const layout = dashboardLayouts.find((l) => l === v.layout) ?? defaultDashboardView.layout;
  const show = Array.isArray(v.show) ? statuses.filter((s) => v.show && (v.show as unknown[]).includes(s)) : [];
  const sort = (v.sort && typeof v.sort === "object" ? v.sort : {}) as Record<string, unknown>;
  return {
    layout,
    show: show.length ? show : defaultDashboardView.show,
    sort: {
      by: sortKeys.find((k) => k === sort.by) ?? defaultDashboardView.sort.by,
      dir: sortDirs.find((d) => d === sort.dir) ?? defaultDashboardView.sort.dir,
    },
  };
}
