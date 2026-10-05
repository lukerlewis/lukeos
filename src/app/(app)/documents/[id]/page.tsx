import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Comments } from "@/components/comments/comments";
import { DocumentEditor } from "@/components/documents/document-editor";
import { documentFont } from "@/components/documents/fonts";
import { listComments } from "@/core/comments";
import { OperationError } from "@/core/define";
import { getDocument } from "@/core/documents";
import { listProjects } from "@/core/projects";
import { getTimeZone } from "@/core/settings";
import { COMMENTABLE } from "@/lib/comments";

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    return await getDocument(id);
  } catch (err) {
    if (err instanceof OperationError) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: PageProps<"/documents/[id]">): Promise<Metadata> {
  const doc = await load((await params).id);
  return { title: `${doc.title || "Untitled"} · LukeOS` };
}

export default async function DocumentPage({ params, searchParams }: PageProps<"/documents/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [doc, projects, threads, timeZone] = await Promise.all([
    load(id),
    listProjects(),
    listComments({ targetType: "document", targetId: id }),
    getTimeZone(),
  ]);
  const back = doc.madeBy.kind === "agent" ? { href: "/documents?by=claude", label: "Documents" } : { href: "/documents", label: "Documents" };

  return (
    <div className={`flex min-w-0 grow flex-col ${documentFont.variable}`}>
      <header className="hidden h-14 shrink-0 items-center gap-2 border-b px-6 md:flex">
        <Link href={back.href} className="inline-flex items-center text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
      </header>
      <div className="flex flex-col gap-2 px-5 pt-[max(env(safe-area-inset-top),1rem)] pb-28 md:px-8 md:pt-6 md:pb-10">
        <Link
          href={back.href}
          className="-ml-1 inline-flex items-center self-start pt-8 text-meta text-muted-foreground hover:text-foreground md:hidden"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
        <div className="grid items-start gap-8 2xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0" {...{ [COMMENTABLE]: "" }}>
            <DocumentEditor
              key={doc.id}
              doc={doc}
              projects={projects.map((p) => ({ id: p.id, name: p.name }))}
              autoFocus={query.new === "1"}
            />
          </div>
          <aside className="mx-auto w-full max-w-[8.5in] 2xl:sticky 2xl:top-6">
            <Comments target={{ type: "document", id: doc.id }} threads={threads} timeZone={timeZone} />
          </aside>
        </div>
      </div>
    </div>
  );
}
