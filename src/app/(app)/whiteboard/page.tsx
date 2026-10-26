import type { Metadata } from "next";
import { EmptyState, Page } from "@/components/shell/page";
import { chipProjects, countByProject, pickedFromQuery, ProjectChips, withProjects } from "@/components/ui/project-chips";
import { BoardGrid, NewWhiteboardButton } from "@/components/whiteboard/board-list";
import { listProjects } from "@/core/projects";
import { listWhiteboardsWithItems } from "@/core/whiteboards";

export const metadata: Metadata = { title: "Whiteboard · LukeOS" };

export default async function WhiteboardsPage({ searchParams }: PageProps<"/whiteboard">) {
  const [query, all, projects] = await Promise.all([searchParams, listWhiteboardsWithItems(), listProjects()]);
  const picked = pickedFromQuery(query.project, projects);
  const chips = chipProjects(projects);
  const boards = (picked.length ? all.filter((b) => b.projectId && picked.includes(b.projectId)) : all).map((b) => ({
    ...b,
    project: chips.find((p) => p.id === b.projectId) ?? null,
    updatedAt: b.updatedAt.toISOString(),
  }));
  return (
    <Page title="Whiteboard" newTask={false} actions={<NewWhiteboardButton projectId={picked.length === 1 ? picked[0] : null} />}>
      <div className="flex flex-col gap-4">
        <ProjectChips
          projects={chips}
          counts={countByProject(all.map((b) => b.projectId))}
          total={all.length}
          picked={picked}
          href={(ids) => withProjects("/whiteboard", {}, ids)}
          className="-mx-5 flex-nowrap overflow-x-auto px-5 md:mx-0 md:flex-wrap md:px-0"
        />
        {boards.length === 0 ? <EmptyState>No whiteboards yet.</EmptyState> : <BoardGrid boards={boards} />}
      </div>
    </Page>
  );
}
