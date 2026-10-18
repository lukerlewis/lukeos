import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { boardViews } from "@/lib/board";
import { dashboardLayouts, parseDashboardView, sortDirs, sortKeys, type DashboardView } from "@/lib/dashboard";
import { getBoard, showField } from "./board";
import { defineOperation } from "./define";

const KEY = "dashboard";

/** How Luke last set up his dashboard. Saved in the app, so it's the same on every device. */
export async function getDashboardView(): Promise<DashboardView> {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).limit(1);
  try {
    return parseDashboardView(row ? JSON.parse(row.value) : null);
  } catch {
    return parseDashboardView(null);
  }
}

export const dashboardOperations = {
  get_dashboard: defineOperation({
    name: "get_dashboard",
    description:
      'Luke\'s dashboard (the app\'s home screen) as he has it set up. It has two tabs: Today (layout "list"), which shows the tasks in his Today list, and Board, which shows every task in columns by list (Today, Tomorrow, This week, Later). Lists are set by hand and have nothing to do with due dates. By default it hides Done tasks; Luke can switch them on in Filters. This returns every column, whichever tab he\'s on; pass by or show to look at it differently without changing Luke\'s setup. "view" in the result is his saved setup.',
    input: z.object({
      by: z.enum(boardViews).optional().describe('"when" (the default, as on the dashboard) or "status".'),
      show: showField.optional().describe("Only tasks with these statuses. Leave out to use Luke's choice."),
    }),
    run: async ({ by, show }) => {
      const view = await getDashboardView();
      const board = await getBoard(by ?? "when", undefined, show ?? view.show);
      return { view, today: board.today, groups: board.columns };
    },
  }),

  set_dashboard_view: defineOperation({
    name: "set_dashboard_view",
    description:
      "Change how Luke's dashboard looks, just like the switches at the top of it: the Today tab or the Board, which statuses show, and how tasks are sorted (in the Today list and in each Board column). Only change this when Luke asks. Fields left out stay as they are. (Whether it shows Work or Life is chosen on each device, not here.)",
    input: z.object({
      layout: z.enum(dashboardLayouts).optional().describe('"list" (the Today tab) or "board".'),
      show: showField.optional().describe("Which statuses to show, e.g. [\"todo\"] or [\"todo\", \"doing\"]."),
      sort: z
        .object({ by: z.enum(sortKeys), dir: z.enum(sortDirs) })
        .optional()
        .describe('How the Today list and each Board column are sorted: by priority, effort (focus type), project, name or created (date added); dir "desc" (high to low, newest first) or "asc".'),
    }),
    run: async (changes) => {
      const current = await getDashboardView();
      const view = parseDashboardView({ ...current, ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) });
      const value = JSON.stringify(view);
      await db
        .insert(schema.appSettings)
        .values({ key: KEY, value })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
      return view;
    },
  }),
};
