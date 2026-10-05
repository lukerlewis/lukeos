import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ArtifactView } from "@/components/artifacts/artifact-view";
import { Comments } from "@/components/comments/comments";
import { getArtifact, inlineImages } from "@/core/artifacts";
import { listComments } from "@/core/comments";
import { OperationError } from "@/core/define";
import { listProjects } from "@/core/projects";
import { getTimeZone } from "@/core/settings";

async function load(id: string, version?: number) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    return await getArtifact(id, version);
  } catch (err) {
    if (err instanceof OperationError) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: PageProps<"/artifacts/[id]">): Promise<Metadata> {
  const artifact = await load((await params).id);
  return { title: `${artifact.title || "Untitled"} · LukeOS` };
}

export default async function ArtifactPage({ params, searchParams }: PageProps<"/artifacts/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const version = typeof query.v === "string" && /^\d+$/.test(query.v) ? Number(query.v) : undefined;
  const [artifact, projects, threads, timeZone] = await Promise.all([
    load(id, version),
    listProjects(),
    listComments({ targetType: "artifact", targetId: id }),
    getTimeZone(),
  ]);
  // Photos in web pages go inside the page, since a sandboxed page can't fetch them.
  const content = await Promise.all(
    artifact.content.map(async (p) => (p.format === "html" ? { ...p, content: await inlineImages(p.content) } : p)),
  );
  const back = artifact.project
    ? { href: `/projects/${artifact.project.id}?view=notes`, label: artifact.project.name }
    : { href: "/agents", label: "Agents" };

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
          className="-ml-1 inline-flex items-center self-start pt-8 text-meta text-muted-foreground hover:text-foreground md:hidden"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
        <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className={content.some((p) => p.format === "html") ? "min-w-0" : "min-w-0 max-w-3xl"}>
            <ArtifactView
              key={`${artifact.id}-${artifact.shown.number}`}
              artifact={{ ...artifact, content }}
              projects={projects.map((p) => ({ id: p.id, name: p.name }))}
            />
          </div>
          <aside className="xl:sticky xl:top-6">
            <Comments
              target={{ type: "artifact", id: artifact.id }}
              threads={threads}
              timeZone={timeZone}
              currentVersion={artifact.version}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
