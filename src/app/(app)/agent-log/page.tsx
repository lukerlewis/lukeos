import type { Metadata } from "next";
import { ActivityList, type ActivityRow } from "@/components/from-claude/activity-list";
import { ClaudeItemList } from "@/components/from-claude/item-list";
import { MarkFromClaudeSeen } from "@/components/from-claude/mark-seen";
import { editedLabel } from "@/components/notes/note-list";
import { EmptyState, Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { listActivity } from "@/core/activity";
import { claudeRoutines, listFromClaude, type ClaudeItem } from "@/core/from-claude";
import { getTimeZone } from "@/core/settings";
import { friendlyDay, todayIn } from "@/lib/dates";

export const metadata: Metadata = { title: "Agent log · LukeOS" };

const types = [
  { value: undefined, label: "Everything" },
  { value: "note", label: "Notes" },
  { value: "task", label: "Tasks" },
  { value: "project", label: "Projects" },
] as const;

const views = [
  { value: undefined, label: "Made by Claude" },
  { value: "activity", label: "Activity log" },
] as const;

export default async function FromClaudePage({ searchParams }: PageProps<"/agent-log">) {
  const query = await searchParams;
  const viewSwitch = (active: string | undefined) => (
    <SegmentedLinks
      label="View"
      className="self-start"
      options={views.map((v) => ({ href: v.value ? `/agent-log?view=${v.value}` : "/agent-log", label: v.label, active: active === v.value }))}
    />
  );
  if (query.view === "activity") return <ActivityPage viewSwitch={viewSwitch("activity")} />;

  const type = types.find((t) => t.value && t.value === query.type)?.value as ClaudeItem["type"] | undefined;
  const routine = typeof query.routine === "string" && query.routine ? query.routine : undefined;
  const [items, routines, timeZone] = await Promise.all([
    listFromClaude({ type, routine, limit: 200 }),
    claudeRoutines(),
    getTimeZone(),
  ]);
  const href = (next: { type?: string; routine?: string }) => {
    const params = new URLSearchParams();
    if (next.type) params.set("type", next.type);
    if (next.routine) params.set("routine", next.routine);
    const qs = params.toString();
    return qs ? `/agent-log?${qs}` : "/agent-log";
  };
  const when = Object.fromEntries(items.map((i) => [i.id, editedLabel(i.createdAt, timeZone)]));

  return (
    <Page title="Agent log" newTask={false}>
      <MarkFromClaudeSeen hasNew={items.some((i) => i.isNew)} />
      <div className="flex max-w-3xl flex-col gap-4">
        {viewSwitch(undefined)}
        <p className="text-[13px] text-muted-foreground">
          Everything Claude has made for you, newest first. Blue dots are new since you last looked.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedLinks
            label="Type"
            options={types.map((t) => ({ href: href({ type: t.value, routine }), label: t.label, active: type === t.value }))}
          />
          {routines.length > 0 && (
            <SegmentedLinks
              label="Routine"
              className="max-w-full overflow-x-auto"
              options={[
                { href: href({ type }), label: "Any routine", active: !routine },
                ...routines.map((r) => ({ href: href({ type, routine: r }), label: r, active: routine === r })),
              ]}
            />
          )}
        </div>
        <Card>
          {items.length === 0 ? (
            <EmptyState>
              Nothing here yet. When Claude or one of your routines saves something to LukeOS, it lands here.
            </EmptyState>
          ) : (
            <ClaudeItemList items={items} when={when} />
          )}
        </Card>
      </div>
    </Page>
  );
}

/** Every change Claude made through the connector, newest first, grouped by day. */
async function ActivityPage({ viewSwitch }: { viewSwitch: React.ReactNode }) {
  const [entries, timeZone] = await Promise.all([listActivity({ limit: 200 }), getTimeZone()]);
  const today = todayIn(timeZone);
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" });
  const days: { label: string; rows: ActivityRow[] }[] = [];
  let current = "";
  for (const e of entries) {
    const day = todayIn(timeZone, e.at);
    if (day !== current) {
      current = day;
      days.push({ label: friendlyDay(day, today), rows: [] });
    }
    days.at(-1)!.rows.push({
      id: e.id,
      time: clock.format(e.at),
      summary: e.summary,
      who: e.routine ?? (e.name !== "Claude" ? e.name : null),
      item: e.item,
    });
  }

  return (
    <Page title="Agent log" newTask={false}>
      <div className="flex max-w-3xl flex-col gap-4">
        {viewSwitch}
        <p className="text-[13px] text-muted-foreground">
          Each change Claude makes in LukeOS, and when. Things Claude only looked at aren&apos;t listed.
        </p>
        <Card>
          {days.length === 0 ? (
            <EmptyState>Nothing yet. The next time Claude adds, edits or moves something, it shows up here.</EmptyState>
          ) : (
            <ActivityList days={days} />
          )}
        </Card>
      </div>
    </Page>
  );
}
