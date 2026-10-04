import type { Metadata } from "next";
import { activityDays, dayAndTime } from "@/components/from-claude/activity-days";
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
import { listSops } from "@/core/sops";
import { NewRoutineButton } from "@/components/routines/new-routine-button";
import { RoutineList } from "@/components/routines/routine-list";
import { getCheckIns, listRoutines } from "@/core/routines";
import { checkInsLabel } from "@/lib/schedule";
import { NewSopButton } from "@/components/sops/new-sop-button";
import { SopList } from "@/components/sops/sop-list";
import { ContextList } from "@/components/context/context-list";
import { NewContextButton } from "@/components/context/new-context-button";
import { listContext } from "@/core/context";
import { ARTIFACTS_ON } from "@/lib/features";

export const metadata: Metadata = { title: "Agents · LukeOS" };

// Artifacts are on ice (Claude makes documents now), so their tab is hidden and Agents opens on @claude.
const views = [
  ...(ARTIFACTS_ON ? [{ value: undefined, label: "Artifacts" }] : []),
  { value: "claude", label: "@claude" },
  { value: "sops", label: "SOPs" },
  { value: "context", label: "Context" },
  { value: "routines", label: "Routines" },
  { value: "activity", label: "Activity log" },
] as const;

export default async function FromClaudePage({ searchParams }: PageProps<"/agents">) {
  const query = await searchParams;
  const view = typeof query.view === "string" ? query.view : ARTIFACTS_ON ? undefined : "claude";
  const viewSwitch = (active: string | undefined) => (
    <SegmentedLinks
      label="View"
      className="max-w-full self-start overflow-x-auto"
      options={views.map((v) => ({
        href: v.value && (ARTIFACTS_ON || v.value !== "claude") ? `/agents?view=${v.value}` : "/agents",
        label: v.label,
        active: active === v.value,
      }))}
    />
  );
  if (view === "activity") return <ActivityPage viewSwitch={viewSwitch("activity")} />;
  if (view === "claude") return <MentionsPage viewSwitch={viewSwitch("claude")} />;
  if (view === "sops") return <SopsPage viewSwitch={viewSwitch("sops")} />;
  if (view === "context") return <ContextPage viewSwitch={viewSwitch("context")} />;
  if (view === "routines") return <RoutinesPage viewSwitch={viewSwitch("routines")} />;

  const routine = typeof query.routine === "string" && query.routine ? query.routine : undefined;
  const [items, routines, timeZone, projects] = await Promise.all([
    listFromClaude({ type: "artifact", routine, limit: 200 }),
    claudeRoutines(),
    getTimeZone(),
    listProjects(),
  ]);
  const href = (next: { routine?: string }) =>
    next.routine ? `/agents?${new URLSearchParams({ routine: next.routine })}` : "/agents";
  const when = Object.fromEntries(items.map((i) => [i.id, editedLabel(i.createdAt, timeZone)]));

  return (
    <Page title="Agents" newTask={false}>
      <MarkFromClaudeSeen hasNew={items.some((i) => i.isNew)} />
      <div className="flex max-w-3xl flex-col gap-4">
        {viewSwitch(undefined)}
        {routines.length > 0 && (
          <SegmentedLinks
            label="Routine"
            className="max-w-full self-start overflow-x-auto"
            options={[
              { href: href({}), label: "Any routine", active: !routine },
              ...routines.map((r) => ({ href: href({ routine: r }), label: r, active: routine === r })),
            ]}
          />
        )}
        <SelectableClaudeList
          key={routine ?? ""}
          items={items}
          when={when}
          kind="artifact"
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          empty="No artifacts yet."
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
        <Card>
          {days.length === 0 ? (
            <EmptyState>Nothing yet.</EmptyState>
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
  const when = Object.fromEntries(mentions.map((m) => [m.id, dayAndTime(m.createdAt, timeZone)]));

  return (
    <Page title="Agents" newTask={false}>
      <div className="flex max-w-3xl flex-col gap-4">
        {viewSwitch}
        <MentionList mentions={mentions} when={when} />
      </div>
    </Page>
  );
}

/** Luke's SOPs: instructions Claude checks before doing what he asks. */
async function SopsPage({ viewSwitch }: { viewSwitch: React.ReactNode }) {
  const [sops, timeZone] = await Promise.all([listSops(), getTimeZone()]);
  const when = Object.fromEntries(sops.map((s) => [s.id, editedLabel(s.updatedAt, timeZone)]));

  return (
    <Page title="Agents" newTask={false} actions={<NewSopButton />}>
      <div className="flex max-w-3xl flex-col gap-4">
        {viewSwitch}
        <Card>
          {sops.length === 0 ? (
            <EmptyState>No SOPs yet.</EmptyState>
          ) : (
            <SopList sops={sops} when={when} />
          )}
        </Card>
      </div>
    </Page>
  );
}

/** Background Luke wants Claude to know: about him, his audience, and so on. */
async function ContextPage({ viewSwitch }: { viewSwitch: React.ReactNode }) {
  const [files, timeZone] = await Promise.all([listContext(), getTimeZone()]);
  const when = Object.fromEntries(files.map((f) => [f.id, editedLabel(f.updatedAt, timeZone)]));

  return (
    <Page title="Agents" newTask={false} actions={<NewContextButton />}>
      <div className="flex max-w-3xl flex-col gap-4">
        {viewSwitch}
        <Card>
          {files.length === 0 ? <EmptyState>No context yet.</EmptyState> : <ContextList files={files} when={when} />}
        </Card>
      </div>
    </Page>
  );
}

/** Things Luke wants done on a schedule. Claude does whatever's due each time it checks in. */
async function RoutinesPage({ viewSwitch }: { viewSwitch: React.ReactNode }) {
  const [routines, checkIns, timeZone] = await Promise.all([listRoutines(), getCheckIns(), getTimeZone()]);

  return (
    <Page title="Agents" newTask={false} actions={<NewRoutineButton />}>
      <div className="flex max-w-3xl flex-col gap-4">
        {viewSwitch}
        <p className="text-[13px] text-muted-foreground">Check-ins at {checkInsLabel(checkIns)}.</p>
        <Card>
          {routines.length === 0 ? (
            <EmptyState>No routines yet.</EmptyState>
          ) : (
            <RoutineList routines={routines} timeZone={timeZone} />
          )}
        </Card>
      </div>
    </Page>
  );
}
