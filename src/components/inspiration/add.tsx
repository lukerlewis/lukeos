"use client";

import { ImagePlus, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Fab } from "@/components/shell/fab";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useSaving } from "./saving";

/** The add sheet: choose (or drop) files, or paste a link or type a quote. */
function AddDialog({ onClose }: { onClose: () => void }) {
  const { save } = useSaving();
  const [text, setText] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function done(things: { files?: File[]; text?: string }) {
    save(things);
    onClose();
  }

  return (
    <Dialog label="Add to Inspiration" onClose={onClose} focusFirstField={false}>
      <form
        className="flex flex-col gap-3 p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) done({ text });
        }}
      >
        <h2 className="text-base font-semibold">Add to Inspiration</h2>
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const files = Array.from(e.dataTransfer.files);
            if (files.length) done({ files });
            else {
              const dropped = e.dataTransfer.getData("text/uri-list").split(/\r?\n/)[0] || e.dataTransfer.getData("text/plain");
              if (dropped.trim()) done({ text: dropped });
            }
          }}
          className={cn(
            "press-tint flex h-36 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-control font-medium text-muted-foreground",
            over && "border-foreground/40 bg-muted text-foreground",
          )}
        >
          <ImagePlus className="size-7" aria-hidden />
          Choose photos or files
        </button>
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) done({ files });
          }}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) done({ text });
          }}
          rows={3}
          placeholder="Paste a link or write a quote"
          className="resize-none rounded-lg border bg-card px-3 py-2.5 text-body outline-none placeholder:text-muted-foreground focus:border-foreground/30 md:text-sm"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!text.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function AddButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} className={className}>
        <Plus className="size-4" aria-hidden />
        Add
      </Button>
      {open && <AddDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** The round "+" on phones. */
export function AddFab() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Fab label="Add to Inspiration" onClick={() => setOpen(true)} />
      {open && <AddDialog onClose={() => setOpen(false)} />}
    </>
  );
}
