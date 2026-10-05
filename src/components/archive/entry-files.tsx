"use client";

import { File, FileText, Film, Link2, Loader2, Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { EntryFile } from "@/core/archive";
import { fileSize, safeLinkUrl } from "@/lib/archive";
import { op } from "@/lib/ops-client";

const MAX_BYTES = 4 * 1024 * 1024;

function iconOf(f: EntryFile) {
  if (f.kind === "link") return Link2;
  if (f.mimeType === "application/pdf") return FileText;
  if (f.mimeType?.startsWith("video/")) return Film;
  return File;
}

function detailOf(f: EntryFile) {
  if (f.kind === "file") return fileSize(f.bytes);
  try {
    const host = new URL(f.url).hostname.replace(/^www\./, "");
    return host === f.name ? "" : host;
  } catch {
    return "";
  }
}

/** The files and links kept with a Work archive entry, with buttons to add more. */
export function EntryFiles({ entryId, files: initial, onChange }: { entryId: string; files: EntryFile[]; onChange?: (count: number) => void }) {
  const [files, setFiles] = useState(initial);
  const [uploading, setUploading] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  function update(next: EntryFile[]) {
    setFiles(next);
    onChange?.(next.length);
  }

  async function upload(list: FileList | null) {
    for (const file of Array.from(list ?? [])) {
      if (file.size > MAX_BYTES) {
        alert(`“${file.name}” is over 4 MB. Add a link to it instead.`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const res = await fetch(`/api/archive/${entryId}/files`, {
          method: "POST",
          headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
          body: file,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Something went wrong. Try again.");
        setFiles((current) => {
          const next = [...current, body as EntryFile];
          onChange?.(next.length);
          return next;
        });
      } catch (err) {
        alert(`Couldn't add “${file.name}”. ${(err as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function addLink() {
    const url = prompt("Link address", "https://");
    if (!url || url === "https://") return;
    if (!safeLinkUrl(url)) return alert("That doesn't look like a web address.");
    try {
      const link = await op("add_archive_link", { entryId, url });
      update([...files, link]);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function remove(f: EntryFile) {
    if (!confirm(`Remove “${f.name}”?`)) return;
    try {
      await op("remove_archive_file", { id: f.id });
      update(files.filter((x) => x.id !== f.id));
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <section aria-label="Files and links" className="flex flex-col gap-2">
      {files.length > 0 && (
        <ul className="overflow-hidden rounded-xl border bg-card border-stroke">
          {files.map((f) => {
            const Icon = iconOf(f);
            return (
              <li key={f.id} className="flex items-center border-b last:border-b-0">
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="press-tint flex min-h-12 min-w-0 grow items-center gap-3 px-3 py-2 hover:bg-muted/50"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 grow truncate text-control">{f.name}</span>
                  <span className="shrink-0 text-meta text-muted-foreground">{detailOf(f)}</span>
                </a>
                <button
                  type="button"
                  onClick={() => remove(f)}
                  aria-label={`Remove ${f.name}`}
                  className="mr-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={uploading > 0}>
          {uploading > 0 ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Paperclip className="size-4" aria-hidden />}
          {uploading > 0 ? "Adding..." : "Add file"}
        </Button>
        <Button variant="outline" size="sm" onClick={addLink}>
          <Link2 className="size-4" aria-hidden />
          Add link
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          upload(e.target.files);
          e.target.value = "";
        }}
      />
    </section>
  );
}
