import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WhiteboardEditor } from "@/components/whiteboard/editor";
import { listComments } from "@/core/comments";
import { OperationError } from "@/core/define";
import { listProjects } from "@/core/projects";
import { getTimeZone } from "@/core/settings";
import { getWhiteboard, getWhiteboardSettings } from "@/core/whiteboards";

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    return await getWhiteboard(id);
  } catch (err) {
    if (err instanceof OperationError) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: PageProps<"/whiteboard/[id]">): Promise<Metadata> {
  const board = await load((await params).id);
  return { title: `${board.title || "Untitled"} · LukeOS` };
}

export default async function WhiteboardPage({ params, searchParams }: PageProps<"/whiteboard/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [board, projects, settings, threads, timeZone] = await Promise.all([
    load(id),
    listProjects(),
    getWhiteboardSettings(),
    listComments({ targetType: "whiteboard", targetId: id }),
    getTimeZone(),
  ]);
  return (
    <WhiteboardEditor
      key={board.id}
      board={{ id: board.id, title: board.title, projectId: board.projectId, version: board.version, items: board.items }}
      projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      settings={settings}
      comments={{ threads, timeZone, open: query.comments === "1" }}
    />
  );
}
