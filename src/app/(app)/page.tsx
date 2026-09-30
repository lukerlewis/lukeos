import Link from "next/link";
import { Board } from "@/components/board/board";
import { DashboardControls } from "@/components/dashboard/controls";
import { ClaudeItemList } from "@/components/from-claude/item-list";
import { Greeting, TodayDate } from "@/components/greeting";
import { editedLabel, NoteList } from "@/components/notes/note-list";
import { EmptyState, Page } from "@/components/shell/page";
import { StatusIcon } from "@/components/tasks/status-circle";
import { QuickAdd, TaskList } from "@/components/tasks/task-list";
import { Card, CardHeader } from "@/components/ui/card";
import { boardTasks } from "@/core/board";
import { getDashboardView } from "@/core/dashboard";
import { listFromClaude } from "@/core/from-claude";
import { listNotes } from "@/core/notes";
import { listProjects } from "@/core/projects";
import { getTimeZone } from "@/core/settings";
import { columnOf, columnsFor, compareTasks } from "@/lib/board";
import type { DashboardView } from "@/lib/dashboard";
import { colorHex } from "@/lib/project-colors";
import { statusLabel, type Status } from "@/lib/task-fields";

export default async function DashboardPage() {
  const view = await getDashboardView();
  const [{ date, tasks }, projects, notes, fromClaude, timeZone] = await Promise.all([
    boardTasks(view.by, undefined, view.show),
    listProjects(),
    listNotes({ madeBy: "luke", limit: 5 }),
    listFromClaude({ limit: 5 }),
    getTimeZone(),
  ]);
  const newFromClaude = fromClaude.filter((i) => i.isNew).length;
  const board = view.layout === "board";

  const side = (
    <>
      <Card>
        <CardHeader title="Projects" />
        {projects.length === 0 ? (
          <EmptyState>
            No projects yet. <Link href="/projects" className="underline underline-offset-2">Create one</Link>
          </EmptyState>
        ) : (
          <ul>
            {projects.map((p) => {
              const total = p.openTasks + p.doneTasks;
              const pct = total === 0 ? 0 : Math.round((p.doneTasks / total) * 100);
              return (
                <li key={p.id} className="border-b last:border-b-0">
                  <Link href={`/projects/${p.id}`} className="flex flex-col gap-2 px-4 py-3 hover:bg-muted/50">
                    <span className="flex justify-between gap-3">
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {total === 0 ? "No tasks" : `${p.doneTasks} of ${total} done`}
                      </span>
                    </span>
                    <span className="h-1.5 rounded-full bg-muted">
                      <span className="block h-1.5 rounded-full" style={{ width: `${pct}%`, background: colorHex(p.color) }} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader
          title="Agents"
          aside={
            <Link href="/agents" className="hover:text-foreground">
              {newFromClaude > 0 ? `${newFromClaude} new, see all` : "See all"}
            </Link>
          }
        />
        {fromClaude.length === 0 ? (
          <EmptyState>Things Claude saves for you will show here.</EmptyState>
        ) : (
          <ClaudeItemList
            items={fromClaude}
            when={Object.fromEntries(fromClaude.map((i) => [i.id, editedLabel(i.createdAt, timeZone)]))}
          />
        )}
      </Card>
      <Card>
        <CardHeader
          title="Recent notes"
          aside={
            <Link href="/notes" className="hover:text-foreground">
              All notes
            </Link>
          }
        />
        <NoteList notes={notes} timeZone={timeZone} empty={<EmptyState>No notes yet.</EmptyState>} />
      </Card>
    </>
  );

  return (
    <Page title="Dashboard" eyebrow={<TodayDate />} heading={<Greeting />}>
      <DashboardControls view={view} />
      {board ? (
        <>
          <Board tasks={tasks} view={view.by} today={date} show={view.show} />
          <div className="grid items-start gap-6 md:grid-cols-2 xl:grid-cols-3">{side}</div>
        </>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-5">
            <TaskSections tasks={tasks} view={view} today={date} />
          </div>
          <div className="flex flex-col gap-6">{side}</div>
        </div>
      )}
    </Page>
  );
}

/** The list layout: one card per board column, in the same order. */
function TaskSections({
  tasks,
  view,
  today,
}: {
  tasks: Awaited<ReturnType<typeof boardTasks>>["tasks"];
  view: DashboardView;
  today: string;
}) {
  // "Add a task" makes a To do task, so it only shows while To do tasks do: under Today, or To do.
  const addTo = !view.show.includes("todo") ? null : view.by === "when" ? "today" : "todo";
  const hidden = (["doing", "done"] as Status[]).filter((s) => !view.show.includes(s));

  return (
    <>
      {columnsFor(view.by, today, view.show).map((column) => {
        const group = tasks.filter((t) => columnOf(t, view.by, today) === column.id).sort(compareTasks);
        const adds = column.id === addTo;
        if (group.length === 0 && !adds) return null;
        return (
          <Card key={column.id}>
            <div className="flex items-center gap-2 border-b px-4 py-3.5">
              {view.by === "status" && <StatusIcon status={column.id as Status} className="size-4" />}
              <h2 className="text-sm font-semibold">{column.title}</h2>
              <span className="text-xs text-muted-foreground">{group.length}</span>
              {column.hint && <span className="ml-auto truncate text-xs text-muted-foreground">{column.hint}</span>}
            </div>
            <TaskList
              tasks={group}
              today={today}
              empty={<EmptyState>{view.by === "when" ? "Nothing due today." : "Nothing here."}</EmptyState>}
            />
            {adds && (
              <QuickAdd
                dueDate={view.by === "when" ? today : undefined}
                placeholder={view.by === "when" ? "Add a task for today" : "Add a task"}
              />
            )}
          </Card>
        );
      })}
      {hidden.length > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          {hidden.map((s) => statusLabel[s]).join(" and ")} tasks are hidden. Switch them on above to see them.
        </p>
      )}
    </>
  );
}
