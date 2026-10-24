"use client";

import { ChevronLeft } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { setEarlyTitle } from "@/lib/early-title";

/**
 * Shown the moment a note opens, shaped like the note. A brand-new note's
 * title can be typed straight away; it's handed to the editor when it arrives.
 */
export default function NoteLoading() {
  const { id } = useParams<{ id: string }>();
  const isNew = useSearchParams().get("new") === "1";

  return (
    <div className="flex min-w-0 grow flex-col" aria-busy="true">
      <div className="hidden h-14 shrink-0 border-b md:block" />
      <div className="flex flex-col gap-2 px-5 pt-[max(env(safe-area-inset-top),1rem)] pb-[calc(7rem+var(--player-space))] md:px-10 md:pt-8 md:pb-10">
        <span className="-ml-1 inline-flex items-center self-start pt-8 text-meta text-muted-foreground md:hidden">
          <ChevronLeft className="size-4" aria-hidden />
          Notes
        </span>
        <div className="flex max-w-3xl flex-col gap-3">
          <textarea
            rows={1}
            autoFocus={isNew}
            readOnly={!isNew}
            defaultValue=""
            onChange={(e) => setEarlyTitle(id, e.target.value.replace(/\n/g, " "))}
            placeholder={isNew ? "Untitled" : ""}
            aria-label="Title"
            className="field-sizing-content resize-none bg-transparent text-title leading-tight font-medium outline-none placeholder:text-muted-foreground"
          />
          <div className="h-5" />
          <p className="text-muted-foreground">{isNew ? "Start writing…" : ""}</p>
        </div>
      </div>
    </div>
  );
}
