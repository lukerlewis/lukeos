import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, FileText, List, SquareKanban } from "lucide-react";
import { ArtifactList } from "@/components/artifacts/artifact-list";
import { Board } from "@/components/board/board";
import { BoardViewSwitch } from "@/components/board/view-switch";
import { NewNoteButton } from "@/components/notes/new-note-button";
import { NoteList } from "@/components/notes/note-list";
import { EditProjectButton } from "@/components/projects/project-dialog";
import { EmptyState, Page } from "@/components/shell/page";
import { StatusIcon } from "@/components/tasks/status-circle";
import { QuickAdd, TaskList } from "@/components/tasks/task-list";
import { Card } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { listArtifacts } from "@/core/artifacts";
import { boardTasks } from "@/core/board";
import { OperationError } from "@/core/define";
import { listNotes } from "@/core/notes";
import { getProject } from "@/core/projects";
import { getTimeZone } from "@/core/settings";
import { listTasks } from "@/core/tasks";
import { todayIn } from "@/lib/dates";
import { colorHex } from "@/lib/project-colors";
import { statusLabel, type Status } from "@/lib/task-fields";

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    return await getProject(id);
  } catch (err) {
    if (err instanceof OperationError) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: PageProps<"/projects/[id]">): Promise<Metadata> {
  const project = await load((await params).id);
  return { title: `${project.name} · LukeOS` };
}

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const page = `/projects/${id}`;
  // A project's board starts with To do / Doing / Done columns.
  const boardView = query.view === "board" ? (query.by === "when" ? "when" : "status") : null;
  const notesView = query.view === "notes";
  const listView = !boardView && !notesView;

  const [project, tasks, timeZone, board, notes, artifacts] = await Promise.all([
    load(id),
    listView ? listTasks({ projectId: id, includeDone: true }) : [],
    getTimeZone(),
    boardView ? boardTasks(boardView, id) : null,
    notesView ? listNotes({ projectId: id }) : [],
    notesView ? listArtifacts({ projectId: id }) : [],
  ]);
  const date = todayIn(timeZone);
  const groups = (["doing", "todo", "done"] as Status[]).map((status) => ({
    status,
    tasks: tasks.filter((t) => t.status === status),
  }));

  return (
    <Page
      title={project.name}
      eyebrow={
        <Link href="/projects" className="-ml-1 inline-flex items-center hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          Projects
        </Link>
      }
      heading={
        <span className="flex items-center gap-3">
          <span className="size-3.5 shrink-0 rounded-[4px]" style={{ background: colorHex(project.color) }} aria-hidden />
          {project.name}
        </span>
      }
      actions={<EditProjectButton project={{ id: project.id, name: project.name, color: project.color }} />}
      newTask={{ projectId: project.id }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedLinks
          label="Layout"
          options={[
            { href: page, label: "List", icon: List, active: listView },
            { href: `${page}?view=board`, label: "Board", icon: SquareKanban, active: !!boardView },
            { href: `${page}?view=notes`, label: "Notes", icon: FileText, active: notesView },
          ]}
        />
        {notesView && <NewNoteButton projectId={project.id} variant="outline" />}
        {boardView && (
          <BoardViewSwitch view={boardView} href={(by) => `${page}?view=board${by === "when" ? "&by=when" : ""}`} />
        )}
      </div>

      {notesView ? (
        <div className="flex max-w-3xl flex-col gap-5">
          <Card>
            <NoteList
              notes={notes}
              timeZone={timeZone}
              showProject={false}
              empty={<EmptyState>No notes in this project yet.</EmptyState>}
            />
          </Card>
          {artifacts.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-sm font-semibold">From Claude</h2>
              <Card>
                <ArtifactList artifacts={artifacts} timeZone={timeZone} />
              </Card>
            </section>
          )}
        </div>
      ) : board && boardView ? (
        <Board tasks={board.tasks} view={boardView} today={board.date} projectId={project.id} showProject={false} />
      ) : (
        <div className="flex max-w-3xl flex-col gap-5">
          {tasks.length === 0 && (
            <Card>
              <EmptyState>No tasks yet. Add the first one below.</EmptyState>
              <QuickAdd projectId={project.id} />
            </Card>
          )}
          {groups.map(({ status, tasks: group }) =>
            group.length === 0 && !(status === "todo" && tasks.length > 0) ? null : (
              <section key={status} className="flex flex-col gap-2">
                <h2 className="flex items-center gap-2 px-1 text-sm font-semibold">
                  <StatusIcon status={status} className="size-4" />
                  {statusLabel[status]}
                  <span className="text-xs font-normal text-muted-foreground">{group.length}</span>
                </h2>
                <Card>
                  <TaskList tasks={group} today={date} showProject={false} />
                  {status === "todo" && <QuickAdd projectId={project.id} />}
                </Card>
              </section>
            ),
          )}
        </div>
      )}
    </Page>
  );
}
