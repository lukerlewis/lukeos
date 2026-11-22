import { NextResponse } from "next/server";
import { getDashboardView } from "@/core/dashboard";
import { getFocusSettings, getScratchPad as getSprintScratchPad } from "@/core/focus";
import { newFromClaudeCount } from "@/core/from-claude";
import { unreadMessageCount } from "@/core/messages";
import { getScratchPad } from "@/core/notes";
import { nextCheckIn } from "@/core/routines";
import { getTimeZone } from "@/core/settings";
import { getSession } from "@/lib/auth/session";
import { todayIn } from "@/lib/dates";

/**
 * What the iPhone app needs as it opens, in one trip: today's date, the counts
 * for its badges, the dashboard's scratch pad and how the dashboard is set up.
 * (The website gets the same things as its pages are built. This isn't an
 * operation, so it doesn't show up as one of Claude's tools.)
 */
export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const [timeZone, unreadMessages, newFromClaude, scratch, dashboardView, focusSettings, sprintScratchPad, next] = await Promise.all([
    getTimeZone(),
    unreadMessageCount(),
    newFromClaudeCount(),
    getScratchPad(),
    getDashboardView(),
    getFocusSettings(),
    getSprintScratchPad(),
    nextCheckIn(),
  ]);
  return NextResponse.json({
    today: todayIn(timeZone),
    timeZone,
    unreadMessages,
    newFromClaude,
    // The dashboard's scratch pad is a note: save it with update_note and this id.
    scratchPad: { id: scratch.id, content: scratch.content, updatedAt: scratch.updatedAt },
    dashboardView,
    focus: { settings: focusSettings, scratchPad: sprintScratchPad },
    // When Claude next reads Messages, or null if no check-ins are set.
    nextCheckIn: next,
  });
}
