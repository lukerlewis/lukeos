import type { Metadata } from "next";
import { Bot, CheckSquare, ChevronRight } from "lucide-react";
import Link from "next/link";
import { NewProjectButton } from "@/components/projects/project-dialog";
import { EmptyState, Page } from "@/components/shell/page";
import { ClaudeBadge } from "@/components/tasks/made-by";
import { Card } from "@/components/ui/card";
import { listProjects } from "@/core/projects";
import { colorHex } from "@/lib/project-colors";

export const metadata: Metadata = { title: "Projects · LukeOS" };

export default async function ProjectsPage() {
  const projects = await listProjects();

  return (
    <Page title="Projects" actions={<span className="hidden md:block"><NewProjectButton /></span>}>
      <Card className="md:hidden">
        <Link href="/tasks" className="flex min-h-14 items-center gap-3 px-4 py-3">
          <CheckSquare className="size-[18px] text-muted-foreground" aria-hidden />
          <span className="grow text-[15px] font-medium">All tasks</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
        <Link href="/agents" className="flex min-h-14 items-center gap-3 border-t px-4 py-3">
          <Bot className="size-[18px] text-muted-foreground" aria-hidden />
          <span className="grow text-[15px] font-medium">Agents</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
      </Card>
      <Card>
        {projects.length === 0 ? (
          <EmptyState>No projects yet. A project holds the tasks and notes for one piece of work.</EmptyState>
        ) : (
          <ul>
            {projects.map((p) => (
              <li key={p.id} className="border-b last:border-b-0">
                <Link href={`/projects/${p.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted/50">
                  <span className="size-3 shrink-0 rounded-[4px]" style={{ background: colorHex(p.color) }} aria-hidden />
                  <span className="grow truncate text-[15px] font-medium md:text-sm">{p.name}</span>
                  <ClaudeBadge madeBy={p.madeBy} />
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {p.openTasks === 0 ? "Nothing open" : `${p.openTasks} open`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="md:hidden">
        <NewProjectButton />
      </div>
    </Page>
  );
}
