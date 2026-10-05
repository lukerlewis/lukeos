import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Comments } from "@/components/comments/comments";
import { DoneTags } from "@/components/notes/done-tags";
import { HtmlNote } from "@/components/notes/html-note";
import { NoteEditor } from "@/components/notes/note-editor";
import { OperationError } from "@/core/define";
import { listFolders } from "@/core/folders";
import { getNote } from "@/core/notes";
import { listComments } from "@/core/comments";
import { doneMentionIds } from "@/core/mentions";
import { listProjects } from "@/core/projects";
import { getTimeZone } from "@/core/settings";
import { COMMENTABLE } from "@/lib/comments";

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    return await getNote(id);
  } catch (err) {
    if (err instanceof OperationError) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: PageProps<"/notes/[id]">): Promise<Metadata> {
  const note = await load((await params).id);
  return { title: `${note.title || "Untitled"} · LukeOS` };
}

export default async function NotePage({ params, searchParams }: PageProps<"/notes/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [note, projects, folders, threads, timeZone, done] = await Promise.all([
    load(id),
    listProjects(),
    listFolders(),
    listComments({ targetType: "note", targetId: id }),
    getTimeZone(),
    doneMentionIds("note", id),
  ]);
  // The scratch pad lives on the dashboard.
  if (note.scratchPad) redirect("/");
  const back = note.folder
    ? { href: `/notes?folder=${note.folder.id}`, label: note.folder.name }
    : note.project
    ? { href: `/projects/${note.project.id}?view=notes`, label: note.project.name }
    : { href: "/notes", label: "Notes" };

  return (
    <div className="flex min-w-0 grow flex-col">
      <DoneTags ids={done} />
      <header className="hidden h-14 shrink-0 items-center gap-2 border-b px-6 md:flex">
        <Link href={back.href} className="inline-flex items-center text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
      </header>
      <div className="flex flex-col gap-2 px-5 pt-[max(env(safe-area-inset-top),1rem)] pb-28 md:px-10 md:pt-8 md:pb-10">
        <Link
          href={back.href}
          className="-ml-1 inline-flex items-center self-start pt-8 text-meta text-muted-foreground hover:text-foreground md:hidden"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
        <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className={note.format === "html" ? "min-w-0" : "min-w-0 max-w-3xl"} {...{ [COMMENTABLE]: "" }}>
            {note.format === "html" ? (
              <HtmlNote note={note} projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
            ) : (
              <NoteEditor
                key={note.id}
                note={note}
                projects={projects.map((p) => ({ id: p.id, name: p.name }))}
                folders={folders.map((f) => ({ id: f.id, name: f.name }))}
                autoFocus={query.new === "1"}
              />
            )}
          </div>
          <aside className="xl:sticky xl:top-6">
            <Comments target={{ type: "note", id: note.id }} threads={threads} timeZone={timeZone} />
          </aside>
        </div>
      </div>
    </div>
  );
}
