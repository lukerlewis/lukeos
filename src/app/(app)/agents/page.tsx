import type { Metadata } from "next";
import { ActivityList, type ActivityRow } from "@/components/from-claude/activity-list";
import { MarkFromClaudeSeen } from "@/components/from-claude/mark-seen";
import { SelectableClaudeList } from "@/components/from-claude/selectable-list";
import { editedLabel } from "@/components/notes/note-list";
import { EmptyState, Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { listActivity } from "@/core/activity";
import { claudeRoutines, listFromClaude } from "@/core/from-claude";
import { listProjects } from "@/core/projects";
import { getTimeZone } from "@/core/settings";
import { friendlyDay, todayIn } from "@/lib/dates";

export const metadata: Metadata = { title: "Agents · LukeOS" };

const types = [
  { value: "task", label: "Tasks" },
  { value: "note", label: "Notes" },
] as const;

const views = [
  { value: undefined, label: "Made by Claude" },
  { value: "activity", label: "Activity log" },
] as const;

export default async function FromClaudePage({ searchParams }: PageProps<"/agents">) {
  const query = await searchParams;
  const viewSwitch = (active: string | undefined) => (
    <SegmentedLinks
      label="View"
      className="self-start"
      options={views.map((v) => ({ href: v.value ? `/agents?view=${v.value}` : "/agents", label: v.label, active: active === v.value }))}
    />
  );
  if (query.view === "activity") return <ActivityPage viewSwitch={viewSwitch("activity")} />;

  const type: "task" | "note" = query.type === "note" ? "note" : "task";
  const routine = typeof query.routine === "string" && query.routine ? query.routine : undefined;
  const [items, routines, timeZone, projects] = await Promise.all([
    listFromClaude({ type, routine, limit: 200 }),
    claudeRoutines(),
    getTimeZone(),
    listProjects(),
  ]);
  const href = (next: { type?: string; routine?: string }) => {
    const params = new URLSearchParams();
    if (next.type === "note") params.set("type", next.type);
    if (next.routine) params.set("routine", next.routine);
    const qs = params.toString();
    return qs ? `/agents?${qs}` : "/agents";
  };
  const when = Object.fromEntries(items.map((i) => [i.id, editedLabel(i.createdAt, timeZone)]));

  return (
    <Page title="Agents" newTask={false}>
      <MarkFromClaudeSeen hasNew={items.some((i) => i.isNew)} />
      <div className="flex max-w-3xl flex-col gap-4">
        {viewSwitch(undefined)}
        <p className="text-[13px] text-muted-foreground">
          Tasks and notes Claude has made for you, newest first. Blue dots are new since you last looked. Tap Select to change
          several at once.
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
        <SelectableClaudeList
          key={`${type}-${routine ?? ""}`}
          items={items}
          when={when}
          kind={type}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          empty={`No ${type}s from Claude yet. When Claude or one of your routines makes one, it lands here.`}
        />
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
    <Page title="Agents" newTask={false}>
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
