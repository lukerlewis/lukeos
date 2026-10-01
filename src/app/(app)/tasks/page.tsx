import type { Metadata } from "next";
import { EmptyState, Page } from "@/components/shell/page";
import { QuickAdd, TaskList } from "@/components/tasks/task-list";
import { Card, CardHeader } from "@/components/ui/card";
import { today } from "@/core/settings";
import { listTasks } from "@/core/tasks";
import { whenOf, type When } from "@/lib/dates";

export const metadata: Metadata = { title: "All tasks · LukeOS" };

const sections: { when: When; title: string }[] = [
  { when: "overdue", title: "Late" },
  { when: "today", title: "Today" },
  { when: "tomorrow", title: "Tomorrow" },
  { when: "week", title: "This week" },
  { when: "later", title: "Later" },
  { when: "none", title: "No date" },
];

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
            <QuickAdd />
          </Card>
        )}
        {sections.map(({ when, title }) => {
          const group = open.filter((t) => whenOf(t.dueDate, date) === when);
          if (group.length === 0) return null;
          return (
            <Card key={when}>
              <CardHeader title={title} aside={group.length} />
              <TaskList tasks={group} today={date} />
              {when === "none" && <QuickAdd />}
            </Card>
          );
        })}
        {open.length > 0 && !open.some((t) => t.dueDate === null) && (
          <Card>
            <QuickAdd />
          </Card>
        )}
        {recentlyDone.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer px-1 py-1 text-sm font-semibold text-muted-foreground select-none">
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
