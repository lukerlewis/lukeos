import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WhiteboardEditor } from "@/components/whiteboard/editor";
import { OperationError } from "@/core/define";
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

export default async function WhiteboardPage({ params }: PageProps<"/whiteboard/[id]">) {
  const [board, settings] = await Promise.all([load((await params).id), getWhiteboardSettings()]);
  return <WhiteboardEditor key={board.id} board={{ id: board.id, title: board.title, version: board.version, items: board.items }} settings={settings} />;
}
