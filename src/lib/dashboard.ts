/**
 * How the dashboard is laid out and which tasks it shows. Shared by the
 * dashboard screen and the get_dashboard / set_dashboard_view operations, so
 * Luke and Claude see the same thing.
 */
import { statuses, type Status } from "./task-fields";

export const dashboardLayouts = ["list", "board"] as const;
export type DashboardLayout = (typeof dashboardLayouts)[number];

export type DashboardView = {
  /**
   * "list" is the Today tab: just the tasks due today (or late).
   * "board" is every task in columns by when it's due (Today, Tomorrow, This week, Later).
   */
  layout: DashboardLayout;
  /** Which statuses to show. Starts with To do and Doing, so finished tasks are hidden. */
  show: Status[];
};

export const defaultDashboardView: DashboardView = { layout: "list", show: ["todo", "doing"] };

/** Reads a saved view, falling back to the default for anything missing or unknown. */
export function parseDashboardView(raw: unknown): DashboardView {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const layout = dashboardLayouts.find((l) => l === v.layout) ?? defaultDashboardView.layout;
  const show = Array.isArray(v.show) ? statuses.filter((s) => v.show && (v.show as unknown[]).includes(s)) : [];
  return { layout, show: show.length ? show : defaultDashboardView.show };
}
