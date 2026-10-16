import type { Metadata } from "next";
import { Archive, Globe, Bot, MessagesSquare, Search, Lightbulb, Shapes, FileText, CheckSquare, ChevronRight, Trash2 } from "lucide-react";
import Link from "next/link";
import { NewProjectButton } from "@/components/projects/project-dialog";
import { EmptyState, Page } from "@/components/shell/page";
import { ClaudeBadge } from "@/components/tasks/made-by";
import { Card } from "@/components/ui/card";
import { unreadMessageCount } from "@/core/messages";
import { listProjects } from "@/core/projects";
import { colorHex } from "@/lib/project-colors";

export const metadata: Metadata = { title: "Projects · LukeOS" };

export default async function ProjectsPage() {
  const [projects, unread] = await Promise.all([listProjects(), unreadMessageCount()]);

  return (
    // On phones this is the More tab: Messages, Search, All tasks, Documents, Whiteboard, Inspiration, Work archive, Portfolio, Agents and Trash, then the projects.
    <Page
      title="Projects"
      heading={
        <>
          <span className="md:hidden">More</span>
          <span className="hidden md:inline">Projects</span>
        </>
      }
      actions={<span className="hidden md:block"><NewProjectButton /></span>}
    >
      <Card className="md:hidden">
        <Link href="/messages" className="press-tint flex min-h-14 items-center gap-3 px-4 py-3">
          <MessagesSquare className="size-[18px] text-muted-foreground" aria-hidden />
          <span className="grow text-control font-medium">Messages</span>
          {unread > 0 && (
            <span className="min-w-[20px] rounded-full bg-notification px-1.5 text-center text-xs leading-5 font-medium text-on-notification">
              {unread}
              <span className="sr-only"> unread</span>
            </span>
          )}
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
        <Link href="/search" className="press-tint flex min-h-14 items-center gap-3 border-t px-4 py-3">
          <Search className="size-[18px] text-muted-foreground" aria-hidden />
          <span className="grow text-control font-medium">Search</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
        <Link href="/tasks" className="press-tint flex min-h-14 items-center gap-3 border-t px-4 py-3">
          <CheckSquare className="size-[18px] text-muted-foreground" aria-hidden />
          <span className="grow text-control font-medium">All tasks</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
        <Link href="/documents" className="press-tint flex min-h-14 items-center gap-3 border-t px-4 py-3">
          <FileText className="size-[18px] text-muted-foreground" aria-hidden />
          <span className="grow text-control font-medium">Documents</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
        <Link href="/whiteboard" className="press-tint flex min-h-14 items-center gap-3 border-t px-4 py-3">
          <Shapes className="size-[18px] text-muted-foreground" aria-hidden />
          <span className="grow text-control font-medium">Whiteboard</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
        <Link href="/inspiration" className="press-tint flex min-h-14 items-center gap-3 border-t px-4 py-3">
          <Lightbulb className="size-[18px] text-muted-foreground" aria-hidden />
          <span className="grow text-control font-medium">Inspiration</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
        <Link href="/archive" className="press-tint flex min-h-14 items-center gap-3 border-t px-4 py-3">
          <Archive className="size-[18px] text-muted-foreground" aria-hidden />
          <span className="grow text-control font-medium">Work archive</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
        <Link href="/portfolio" className="press-tint flex min-h-14 items-center gap-3 border-t px-4 py-3">
          <Globe className="size-[18px] text-muted-foreground" aria-hidden />
          <span className="grow text-control font-medium">Portfolio</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
        <Link href="/agents" className="press-tint flex min-h-14 items-center gap-3 border-t px-4 py-3">
          <Bot className="size-[18px] text-muted-foreground" aria-hidden />
          <span className="grow text-control font-medium">Agents</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
        <Link href="/trash" className="press-tint flex min-h-14 items-center gap-3 border-t px-4 py-3">
          <Trash2 className="size-[18px] text-muted-foreground" aria-hidden />
          <span className="grow text-control font-medium">Trash</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
      </Card>
      <h2 className="-mb-3 px-1 text-sm font-medium text-muted-foreground md:hidden">Projects</h2>
      <Card>
        {projects.length === 0 ? (
          <EmptyState>No projects yet.</EmptyState>
        ) : (
          <ul>
            {projects.map((p) => (
              <li key={p.id} className="border-b last:border-b-0">
                <Link href={`/projects/${p.id}`} className="press-tint flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted/50">
                  <span className="size-3 shrink-0 rounded-[4px]" style={{ background: colorHex(p.color) }} aria-hidden />
                  <span className="grow truncate text-control font-medium">{p.name}</span>
                  <ClaudeBadge madeBy={p.madeBy} />
                  <span className="shrink-0 text-meta text-muted-foreground">
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
