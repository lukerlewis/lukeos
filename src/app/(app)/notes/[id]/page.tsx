import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { HtmlNote } from "@/components/notes/html-note";
import { NoteEditor } from "@/components/notes/note-editor";
import { OperationError } from "@/core/define";
import { getNote } from "@/core/notes";
import { listProjects } from "@/core/projects";

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
  const [note, projects] = await Promise.all([load(id), listProjects()]);
  const back = note.project
    ? { href: `/projects/${note.project.id}?view=notes`, label: note.project.name }
    : { href: "/notes", label: "Notes" };

  return (
    <div className="flex min-w-0 grow flex-col">
      <header className="hidden h-14 shrink-0 items-center gap-2 border-b px-6 md:flex">
        <Link href={back.href} className="inline-flex items-center text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
      </header>
      <div className="flex flex-col gap-2 px-5 pt-[max(env(safe-area-inset-top),1rem)] pb-28 md:px-10 md:pt-8 md:pb-10">
        <Link
          href={back.href}
          className="-ml-1 inline-flex items-center self-start pt-8 text-[13px] text-muted-foreground hover:text-foreground md:hidden"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
        <div className={note.format === "html" ? "w-full" : "w-full max-w-3xl"}>
          {note.format === "html" ? (
            <HtmlNote note={note} projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
          ) : (
            <NoteEditor
              key={note.id}
              note={note}
              projects={projects.map((p) => ({ id: p.id, name: p.name }))}
              autoFocus={query.new === "1"}
            />
          )}
        </div>
      </div>
    </div>
  );
}
