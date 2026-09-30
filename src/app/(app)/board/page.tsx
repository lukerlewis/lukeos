import type { Metadata } from "next";
import { Board } from "@/components/board/board";
import { BoardViewSwitch } from "@/components/board/view-switch";
import { Page } from "@/components/shell/page";
import { boardTasks } from "@/core/board";

export const metadata: Metadata = { title: "Board · LukeOS" };

export default async function BoardPage({ searchParams }: PageProps<"/board">) {
  const view = (await searchParams).by === "status" ? "status" : "when";
  const { date, tasks } = await boardTasks(view);

  return (
    <Page title="Board">
      <BoardViewSwitch view={view} href={(by) => (by === "when" ? "/board" : `/board?by=${by}`)} />
      <Board tasks={tasks} view={view} today={date} />
    </Page>
  );
}
