import type { Metadata } from "next";
import { EmptyState, Page } from "@/components/shell/page";
import { BoardGrid, NewWhiteboardButton } from "@/components/whiteboard/board-list";
import { listWhiteboardsWithItems } from "@/core/whiteboards";

export const metadata: Metadata = { title: "Whiteboard · LukeOS" };

export default async function WhiteboardsPage() {
  const boards = (await listWhiteboardsWithItems()).map((b) => ({ ...b, updatedAt: b.updatedAt.toISOString() }));
  return (
    <Page title="Whiteboard" newTask={false} actions={<NewWhiteboardButton />}>
      {boards.length === 0 ? <EmptyState>No whiteboards yet.</EmptyState> : <BoardGrid boards={boards} />}
    </Page>
  );
}
