import type { Metadata } from "next";
import { EmptyState, Page } from "@/components/shell/page";
import { QuickAdd, TaskList } from "@/components/tasks/task-list";
import { Card, CardHeader } from "@/components/ui/card";
import { today } from "@/core/settings";
import { listTasks } from "@/core/tasks";
import { bucketLabel, buckets } from "@/lib/task-fields";

export const metadata: Metadata = { title: "All tasks · LukeOS" };

export default async function TasksPage() {
  const [date, open, done] = await Promise.all([today(), listTasks({}), listTasks({ status: "done", limit: 200 })]);
  const recentlyDone = done
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
    .slice(0, 20);

  return (
    <Page title="All tasks">
      <div className="flex max-w-3xl flex-col gap-5">
        {open.length === 0 && (
          <Card>
            <EmptyState>Nothing open.</EmptyState>
            <QuickAdd today={date} />
          </Card>
        )}
        {buckets.map((bucket) => {
          const group = open.filter((t) => t.bucket === bucket);
          if (group.length === 0) return null;
          return (
            <Card key={bucket}>
              <CardHeader title={bucketLabel[bucket]} aside={group.length} />
              <TaskList tasks={group} today={date} />
              <QuickAdd bucket={bucket} today={date} />
            </Card>
          );
        })}
        {recentlyDone.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer px-1 py-1 text-sm font-medium text-muted-foreground select-none">
              Recently done ({recentlyDone.length})
            </summary>
            <Card className="mt-2">
              <TaskList tasks={recentlyDone} today={date} />
            </Card>
          </details>
        )}
      </div>
    </Page>
  );
}
