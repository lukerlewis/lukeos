import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Folder as FolderIcon, Lightbulb, List, NotebookPen, SquareKanban } from "lucide-react";
import { ArtifactList } from "@/components/artifacts/artifact-list";
import { AddButton } from "@/components/inspiration/add";
import { InspirationBoard } from "@/components/inspiration/board";
import { Board } from "@/components/board/board";
import { BoardViewSwitch, type BoardGrouping } from "@/components/board/view-switch";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";
import { getPipeline, listColumns } from "@/core/pipeline";
import { NewFolderButton } from "@/components/notes/folder-dialog";
import { NewNoteButton } from "@/components/notes/new-note-button";
import { NoteList } from "@/components/notes/note-list";
import { EditProjectButton } from "@/components/projects/project-dialog";
import { EmptyState, Page } from "@/components/shell/page";
import { StatusIcon } from "@/components/tasks/status-circle";
import { QuickAdd, TaskList } from "@/components/tasks/task-list";
import { Card } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { listArtifacts } from "@/core/artifacts";
import { listDocuments } from "@/core/documents";
import { DocumentList } from "@/components/documents/document-list";
import { ARTIFACTS_ON } from "@/lib/features";
import { boardTasks } from "@/core/board";
import { OperationError } from "@/core/define";
import { listFolders } from "@/core/folders";
import { listInspiration } from "@/core/inspiration";
import { listNotes } from "@/core/notes";
import { getProject, listProjects } from "@/core/projects";
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
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const pipelineColumns = await listColumns(id);
  const hasPipeline = pipelineColumns.length > 0;
  // A project with a pipeline opens on it; otherwise on its list, and its board starts with To do / Doing / Done.
  const view = query.view ?? (hasPipeline ? "board" : "list");
  const grouping: BoardGrouping =
    query.by === "when" || query.by === "status" || query.by === "pipeline" ? query.by : hasPipeline ? "pipeline" : "status";
  const pipelineView = view === "board" && grouping === "pipeline";
  const boardView = view === "board" && grouping !== "pipeline" ? grouping : null;
  const notesView = view === "notes";
  const inspirationView = view === "inspiration";
  const listView = !boardView && !pipelineView && !notesView && !inspirationView;

  const [project, tasks, timeZone, board, notes, documents, artifacts, folders, projects, inspiration, pipeline] = await Promise.all([
    load(id),
    listView ? listTasks({ projectId: id, includeDone: true }) : [],
    getTimeZone(),
    boardView ? boardTasks(boardView, id) : null,
    notesView ? listNotes({ projectId: id }) : [],
    notesView ? listDocuments({ projectId: id }) : [],
    notesView && ARTIFACTS_ON ? listArtifacts({ projectId: id }) : [],
    notesView ? listFolders({ projectId: id }) : [],
    notesView || inspirationView ? listProjects() : [],
    inspirationView ? listInspiration({ projectId: id }) : [],
    pipelineView ? getPipeline(id) : null,
  ]);
  // Notes in the folders attached to this project show under their folder.
  const folderIds = new Set(folders.map((f) => f.id));
  const looseNotes = notes.filter((n) => !n.folder || !folderIds.has(n.folder.id));
  const date = todayIn(timeZone);
  const groups = (["doing", "todo", "done"] as Status[]).map((status) => ({
    status,
    tasks: tasks.filter((t) => t.status === status),
  }));

  const toolbar = (
    <>
      <SegmentedLinks
        label="Layout"
        options={[
          { href: `${page}?view=list`, label: "List", icon: List, active: listView },
          { href: `${page}?view=board`, label: "Board", icon: SquareKanban, active: !!boardView || pipelineView },
          { href: `${page}?view=notes`, label: "Notes", icon: NotebookPen, active: notesView },
          { href: `${page}?view=inspiration`, label: "Inspiration", icon: Lightbulb, active: inspirationView },
        ]}
      />
      {notesView && <NewNoteButton projectId={project.id} variant="outline" />}
      {notesView && <NewFolderButton projects={projects.map((p) => ({ id: p.id, name: p.name }))} projectId={project.id} />}
      {(boardView || pipelineView) && (
        <BoardViewSwitch pipeline view={grouping} href={(by) => `${page}?view=board&by=${by}`} />
      )}
    </>
  );

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
      newTask={inspirationView || pipelineView ? false : { projectId: project.id }}
    >
      {!pipelineView && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}


      {pipelineView && pipeline ? (
        <PipelineBoard
          key={typeof query.card === "string" ? query.card : "pipeline"}
          projectId={project.id}
          columns={pipeline.columns}
          openCardId={typeof query.card === "string" ? query.card : undefined}
          timeZone={timeZone}
          today={date}
          toolbar={toolbar}
        />
      ) : inspirationView ? (
        <InspirationBoard
          items={inspiration}
          projects={projects.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
          projectId={project.id}
          empty={
            <Card className="max-w-3xl">
              <EmptyState>Nothing saved to this project yet.</EmptyState>
            </Card>
          }
        >
          <AddButton className="self-start max-md:hidden" />
        </InspirationBoard>
      ) : notesView ? (
        <div className="flex max-w-3xl flex-col gap-5">
          {folders.map((folder) => {
            const inFolder = notes.filter((n) => n.folder?.id === folder.id);
            return (
              <section key={folder.id} className="flex flex-col gap-2">
                <Link
                  href={`/notes?folder=${folder.id}`}
                  className="flex items-center gap-2 self-start px-1 text-sm font-medium hover:text-muted-foreground"
                >
                  <FolderIcon className="size-4 text-muted-foreground" aria-hidden />
                  {folder.name}
                  <span className="text-xs font-normal text-muted-foreground">{inFolder.length}</span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
                <Card>
                  <NoteList
                    notes={inFolder}
                    timeZone={timeZone}
                    showProject={false}
                    empty={<EmptyState>No notes in this folder yet.</EmptyState>}
                  />
                </Card>
              </section>
            );
          })}
          {(looseNotes.length > 0 || folders.length === 0) && (
            <Card>
              <NoteList
                notes={looseNotes}
                timeZone={timeZone}
                showProject={false}
                empty={<EmptyState>No notes in this project yet.</EmptyState>}
              />
            </Card>
          )}
          {documents.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-sm font-medium">Documents</h2>
              <Card>
                <DocumentList documents={documents} timeZone={timeZone} showProject={false} />
              </Card>
            </section>
          )}
          {artifacts.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-sm font-medium">From Claude</h2>
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
              <EmptyState>No tasks yet.</EmptyState>
              <QuickAdd projectId={project.id} today={date} />
            </Card>
          )}
          {groups.map(({ status, tasks: group }) =>
            group.length === 0 && !(status === "todo" && tasks.length > 0) ? null : (
              <section key={status} className="flex flex-col gap-2">
                <h2 className="flex items-center gap-2 px-1 text-sm font-medium">
                  <StatusIcon status={status} className="size-4" />
                  {statusLabel[status]}
                  <span className="text-xs font-normal text-muted-foreground">{group.length}</span>
                </h2>
                <Card>
                  <TaskList tasks={group} today={date} showProject={false} />
                  {status === "todo" && <QuickAdd projectId={project.id} today={date} />}
                </Card>
              </section>
            ),
          )}
        </div>
      )}
    </Page>
  );
}
