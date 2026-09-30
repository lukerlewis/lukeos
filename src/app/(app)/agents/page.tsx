import type { Metadata } from "next";
import { activityDays } from "@/components/from-claude/activity-days";
import { ActivityList } from "@/components/from-claude/activity-list";
import { MarkFromClaudeSeen } from "@/components/from-claude/mark-seen";
import { MentionList } from "@/components/from-claude/mention-list";
import { SelectableClaudeList } from "@/components/from-claude/selectable-list";
import { editedLabel } from "@/components/notes/note-list";
import { EmptyState, Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { listActivity } from "@/core/activity";
import { claudeRoutines, listFromClaude } from "@/core/from-claude";
import { listMentions } from "@/core/mentions";
import { listProjects } from "@/core/projects";
import { getTimeZone } from "@/core/settings";

export const metadata: Metadata = { title: "Agents · LukeOS" };

const types = [
  { value: "artifact", label: "Artifacts" },
  { value: "task", label: "Tasks" },
] as const;

const views = [
  { value: undefined, label: "Made by Claude" },
  { value: "claude", label: "@claude" },
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
  if (query.view === "claude") return <MentionsPage viewSwitch={viewSwitch("claude")} />;

  const type: "task" | "artifact" = query.type === "task" ? "task" : "artifact";
  const routine = typeof query.routine === "string" && query.routine ? query.routine : undefined;
  const [items, routines, timeZone, projects] = await Promise.all([
    listFromClaude({ type, routine, limit: 200 }),
    claudeRoutines(),
    getTimeZone(),
    listProjects(),
  ]);
  const href = (next: { type?: string; routine?: string }) => {
    const params = new URLSearchParams();
    if (next.type === "task") params.set("type", next.type);
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
          What Claude has made for you, newest first. Artifacts are the reports, pages and other things Claude writes; open one
          to read it, see its versions and leave comments. Blue dots are new or updated since you last looked. Tap Select to
          change several at once.
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
  const days = activityDays(entries, timeZone);

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

/** Everywhere Luke wrote @claude: what's waiting for Claude, and what it's done. */
async function MentionsPage({ viewSwitch }: { viewSwitch: React.ReactNode }) {
  const [mentions, timeZone] = await Promise.all([listMentions({ limit: 200 }), getTimeZone()]);
  const clock = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true });
  const when = Object.fromEntries(
    mentions.map((m) => [m.id, `${editedLabel(m.createdAt, timeZone)}, ${clock.format(m.createdAt).replace(/\s*(AM|PM)$/, (_, x: string) => ` ${x.toLowerCase()}`)}`]),
  );

  return (
    <Page title="Agents" newTask={false}>
      <div className="flex max-w-3xl flex-col gap-4">
        {viewSwitch}
        <p className="text-[13px] text-muted-foreground">
          Type @claude anywhere (a note, a task, a comment) to ask Claude something. Each one shows here with where and when you
          wrote it. Claude picks them up the next time it runs, and marks each one done with a note of what it did.
        </p>
        <MentionList mentions={mentions} when={when} />
      </div>
    </Page>
  );
}
