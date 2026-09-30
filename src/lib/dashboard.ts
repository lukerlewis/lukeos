/**
 * How the dashboard is laid out and which tasks it shows. Shared by the
 * dashboard screen and the get_dashboard / set_dashboard_view operations, so
 * Luke and Claude see the same thing.
 */
import { boardViews, type BoardView } from "./board";
import { statuses, type Status } from "./task-fields";

export const dashboardLayouts = ["list", "board"] as const;
export type DashboardLayout = (typeof dashboardLayouts)[number];

export type DashboardView = {
  /** A list of tasks in sections, or a board of cards in columns. */
  layout: DashboardLayout;
  /** Sections or columns by when tasks are due, or by To do / Doing / Done. */
  by: BoardView;
  /** Which statuses to show. Starts with just To do. */
  show: Status[];
};

export const defaultDashboardView: DashboardView = { layout: "list", by: "when", show: ["todo"] };

/** Reads a saved view, falling back to the default for anything missing or unknown. */
export function parseDashboardView(raw: unknown): DashboardView {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const layout = dashboardLayouts.find((l) => l === v.layout) ?? defaultDashboardView.layout;
  const by = boardViews.find((b) => b === v.by) ?? defaultDashboardView.by;
  const show = Array.isArray(v.show) ? statuses.filter((s) => v.show && (v.show as unknown[]).includes(s)) : [];
  return { layout, by, show: show.length ? show : defaultDashboardView.show };
}
