"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MadeByLabel } from "@/components/tasks/made-by";
import { Button } from "@/components/ui/button";
import type { Note } from "@/core/notes";
import { showTrashedToast } from "@/components/shell/toast";
import { op } from "@/lib/ops-client";

/**
 * A note that is a finished web page. It's shown exactly as it was
 * written, walled off in a sandbox so its code can't reach the rest of the
 * app. Luke can move or delete it, but not edit the page itself.
 */
export function HtmlNote({ note, projects }: { note: Note; projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(note.project?.id ?? null);

  async function move(next: string | null) {
    const previous = projectId;
    setProjectId(next);
    try {
      await op("update_note", { id: note.id, projectId: next });
      router.refresh();
    } catch (err) {
      setProjectId(previous);
      alert((err as Error).message);
    }
  }

  async function remove() {
    try {
      await op("delete_note", { id: note.id });
      showTrashedToast("note", note.id, () => router.push(`/notes/${note.id}`));
      router.push(projectId ? `/projects/${projectId}?view=notes` : "/notes");
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-[30px] leading-tight font-semibold tracking-tight break-words md:text-[28px]">
        {note.title || "Untitled"}
      </h1>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <select
          value={projectId ?? ""}
          onChange={(e) => move(e.target.value || null)}
          aria-label="Project"
          className="h-8 max-w-56 rounded-lg border bg-card px-2 text-[13px] text-foreground shadow-xs"
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span>
          <MadeByLabel madeBy={note.madeBy} createdAt={note.createdAt} />
        </span>
        <span>Saved page, view only</span>
        <span className="grow" />
        <Button variant="danger" size="sm" onClick={remove} className="-mr-2">
          <Trash2 className="size-4" aria-hidden />
          Delete
        </Button>
      </div>
      <iframe
        title={note.title || "Saved page"}
        srcDoc={note.content}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        className="h-[calc(100dvh-16rem)] min-h-[480px] w-full rounded-xl border bg-white shadow-xs"
      />
    </div>
  );
}
