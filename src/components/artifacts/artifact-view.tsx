"use client";

import { FilePlus2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MarkdownView } from "@/components/notes/markdown-view";
import { showToast, showTrashedToast } from "@/components/shell/toast";
import { MadeByLabel } from "@/components/tasks/made-by";
import { Button } from "@/components/ui/button";
import type { Artifact } from "@/core/artifacts";
import { COMMENTABLE } from "@/lib/comments";
import { shortDate } from "@/lib/dates";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";

/**
 * An artifact, read only: its parts as tabs, and a menu of its versions.
 * Web pages are walled off in a sandbox so their code can't reach the app.
 */
export function ArtifactView({ artifact, projects }: { artifact: Artifact; projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(artifact.project?.id ?? null);
  const [tab, setTab] = useState(0);
  const part = artifact.content[Math.min(tab, artifact.content.length - 1)];
  const latest = artifact.shown.number === artifact.version;
  const base = `/artifacts/${artifact.id}`;

  async function move(next: string | null) {
    const previous = projectId;
    setProjectId(next);
    try {
      await op("update_artifact", { id: artifact.id, projectId: next });
      router.refresh();
    } catch (err) {
      setProjectId(previous);
      alert((err as Error).message);
    }
  }

  async function copy() {
    try {
      const note = await op("copy_artifact_to_note", { id: artifact.id });
      showToast("Copied to a new note");
      router.push(`/notes/${note.id}`);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function remove() {
    try {
      await op("delete_artifact", { id: artifact.id });
      showTrashedToast("artifact", artifact.id, () => router.push(base));
      router.push(projectId ? `/projects/${projectId}?view=notes` : "/agents");
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h1 className="text-title leading-tight font-medium break-words md:text-title">
        {artifact.title || "Untitled"}
      </h1>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-meta text-muted-foreground">
        <select
          value={projectId ?? ""}
          onChange={(e) => move(e.target.value || null)}
          aria-label="Project"
          className="h-8 max-w-56 rounded-lg border bg-card px-2 text-body text-foreground md:text-meta border-stroke-strong"
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {artifact.versions.length > 1 ? (
          <select
            value={artifact.shown.number}
            onChange={(e) => {
              const n = Number(e.target.value);
              router.push(n === artifact.version ? base : `${base}?v=${n}`);
            }}
            aria-label="Version"
            className="h-8 rounded-lg border bg-card px-2 text-body text-foreground md:text-meta border-stroke-strong"
          >
            {artifact.versions.map((v) => (
              <option key={v.number} value={v.number}>
                Version {v.number}
                {v.number === artifact.version ? " (latest)" : ""}, {shortDate(new Date(v.createdAt).toISOString().slice(0, 10))}
              </option>
            ))}
          </select>
        ) : null}
        <span>
          <MadeByLabel madeBy={artifact.madeBy} createdAt={artifact.createdAt} />
        </span>
        <span className="grow" />
        <Button variant="ghost" size="sm" onClick={copy} title="Make an editable copy in your Notes">
          <FilePlus2 className="size-4" aria-hidden />
          Copy to note
        </Button>
        <Button variant="danger" size="sm" onClick={remove} className="-mr-2">
          <Trash2 className="size-4" aria-hidden />
          Delete
        </Button>
      </div>

      {(!latest || artifact.shown.note) && (
        <p className={cn("rounded-lg px-3 py-2 text-meta", latest ? "bg-muted text-muted-foreground" : "border border-stroke bg-muted text-foreground")}>
          {!latest && (
            <>
              You&apos;re looking at version {artifact.shown.number} of {artifact.version}.{" "}
              <button type="button" className="underline underline-offset-2" onClick={() => router.push(base)}>
                See the latest
              </button>
              {artifact.shown.note ? " · " : ""}
            </>
          )}
          {artifact.shown.note && <>What changed: {artifact.shown.note}</>}
        </p>
      )}

      {artifact.content.length > 1 && (
        <div role="tablist" aria-label="Parts" className="flex gap-1 overflow-x-auto border-b">
          {artifact.content.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={i === tab}
              onClick={() => setTab(i)}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 py-2 text-meta font-medium whitespace-nowrap",
                i === tab ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {p.name || `Part ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      {part.format === "html" ? (
        <iframe
          key={part.id}
          title={part.name || artifact.title || "Web page"}
          srcDoc={part.content}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          className="h-[calc(100dvh-16rem)] min-h-[480px] w-full rounded-xl border bg-white border-stroke"
        />
      ) : (
        <div {...{ [COMMENTABLE]: "" }} className="pb-6">
          <MarkdownView key={part.id} content={part.content} />
        </div>
      )}
    </div>
  );
}
