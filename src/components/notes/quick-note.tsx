"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { showToast } from "@/components/shell/toast";
import { Button } from "@/components/ui/button";
import { op } from "@/lib/ops-client";

/**
 * A box for jotting something down without leaving the dashboard. The first
 * line becomes the note's title and the rest its text; it lands in Notes.
 */
export function QuickNote() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const clean = text.trim();
    if (!clean || busy) return;
    const [first, ...rest] = clean.split("\n");
    setBusy(true);
    try {
      await op("create_note", { title: first.trim().slice(0, 200), content: rest.join("\n").trim() });
      setText("");
      showToast("Note saved");
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
        placeholder="Jot something down…"
        aria-label="Quick note"
        rows={3}
        className="field-sizing-content max-h-60 min-h-20 w-full resize-none rounded-lg border bg-background px-3 py-2 text-[14px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40 md:text-[13px]"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">The first line is the title.</span>
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          {busy ? "Saving…" : "Save note"}
        </Button>
      </div>
    </form>
  );
}
