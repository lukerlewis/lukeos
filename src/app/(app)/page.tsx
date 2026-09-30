import Link from "next/link";
import { Greeting, TodayDate } from "@/components/greeting";
import { EmptyState, Page } from "@/components/shell/page";
import { QuickAdd, TaskList } from "@/components/tasks/task-list";
import { Card, CardHeader } from "@/components/ui/card";
import { listProjects } from "@/core/projects";
import { getToday } from "@/core/tasks";
import { colorHex } from "@/lib/project-colors";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default async function TodayPage() {
  const [{ date, overdue, today, upcoming }, projects] = await Promise.all([getToday(), listProjects()]);
  const dueNow = [...overdue, ...today];

  return (
    <Page title="Today" eyebrow={<TodayDate />} heading={<Greeting />} newTask={{ dueDate: date }}>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="Due today"
              aside={overdue.length > 0 ? `${plural(dueNow.length, "task")}, ${overdue.length} late` : plural(dueNow.length, "task")}
            />
            <TaskList tasks={dueNow} today={date} empty={<EmptyState>Nothing due today.</EmptyState>} />
            <QuickAdd dueDate={date} placeholder="Add a task for today" />
          </Card>
          <Card>
            <CardHeader title="Coming up" aside="Next 7 days" />
            <TaskList tasks={upcoming} today={date} empty={<EmptyState>Nothing due in the next week.</EmptyState>} />
          </Card>
        </div>
        <div className="flex flex-col gap-6">
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
            <CardHeader title="Recent notes" />
            <EmptyState>Notes arrive in a later step.</EmptyState>
          </Card>
        </div>
      </div>
    </Page>
  );
}
