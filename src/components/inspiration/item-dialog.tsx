"use client";

import { Download, ExternalLink, FileText, Globe, Play, Sparkles, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { showTrashedToast } from "@/components/shell/toast";
import { MadeByLabel } from "@/components/tasks/made-by";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { InspirationItem } from "@/core/inspiration";
import { cleanTags, fileDetail } from "@/lib/inspiration";
import { op } from "@/lib/ops-client";

type Project = { id: string; name: string; color: string };
type Change = { title?: string; note?: string; body?: string; tags?: string[]; projectId?: string | null };

const youTubeId = (url: string | null) => {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www\.|m\.)/, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com") return u.searchParams.get("v") ?? u.pathname.match(/^\/(shorts|embed|live)\/([\w-]+)/)?.[2] ?? null;
  } catch {}
  return null;
};

/** Saves changes a moment after typing stops, and whatever's left when the item closes. */
function useSave(id: string) {
  const router = useRouter();
  const pending = useRef<Change>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const changed = useRef(false);

  async function flush() {
    clearTimeout(timer.current);
    const change = pending.current;
    pending.current = {};
    if (!Object.keys(change).length) return;
    changed.current = true;
    try {
      await op("update_inspiration", { id, ...change });
    } catch (err) {
      alert((err as Error).message);
    }
  }

  function queue(change: Change, now = false) {
    pending.current = { ...pending.current, ...change };
    clearTimeout(timer.current);
    if (now) void flush();
    else timer.current = setTimeout(flush, 700);
  }

  async function close() {
    await flush();
    if (changed.current) router.refresh();
  }

  useEffect(() => () => void flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return { queue, close };
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("");
  function add() {
    const next = cleanTags([...tags, ...draft.split(",")]);
    setDraft("");
    if (next.length !== tags.length) onChange(next);
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex h-7 items-center gap-1 rounded-full bg-muted pr-1 pl-2.5 text-[13px]">
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={add}
        placeholder="Add tag"
        aria-label="Add tag"
        className="h-7 min-w-24 grow bg-transparent px-1 text-[16px] outline-none placeholder:text-muted-foreground md:text-[13px]"
      />
    </div>
  );
}

function Media({ item, body, onBody }: { item: InspirationItem; body: string; onBody: (body: string) => void }) {
  const yt = item.kind === "video" ? youTubeId(item.url) : null;
  if (yt)
    return (
      <div className="aspect-video w-full overflow-hidden bg-black md:rounded-l-2xl">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${yt}`}
          title={item.title || "Video"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          className="size-full"
        />
      </div>
    );
  if (item.kind === "text")
    return (
      <div className="flex min-h-56 items-center px-6 py-8 md:min-h-[60dvh] md:px-10">
        <textarea
          value={body}
          onChange={(e) => onBody(e.target.value)}
          aria-label="Quote"
          className="field-sizing-content w-full resize-none bg-transparent font-serif text-[20px] leading-relaxed outline-none md:text-[22px]"
        />
      </div>
    );
  if (item.kind === "file")
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-6 py-10 md:min-h-[50dvh]">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <FileText className="size-8" strokeWidth={1.5} aria-hidden />
        </span>
        {item.file && <span className="text-sm text-muted-foreground">{fileDetail(item.file)}</span>}
        {item.file && (
          <a href={item.file.url} target="_blank" rel="noreferrer" className="text-sm font-medium underline underline-offset-4">
            Open
          </a>
        )}
      </div>
    );
  if (!item.image) return null;
  const picture = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={item.image}
      alt={item.title}
      width={item.width ?? undefined}
      height={item.height ?? undefined}
      className="mx-auto block max-h-[60dvh] w-auto max-w-full object-contain md:max-h-[85dvh]"
    />
  );
  return (
    <div className="flex items-center justify-center bg-muted/60 md:min-h-[60dvh] md:rounded-l-2xl">
      {item.kind === "image" ? (
        picture
      ) : (
        <a href={item.url ?? undefined} target="_blank" rel="noreferrer" className="relative block" aria-label="Open">
          {picture}
          {item.kind === "video" && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                <Play className="ml-0.5 size-6 fill-current" aria-hidden />
              </span>
            </span>
          )}
        </a>
      )}
    </div>
  );
}

/** One item, opened: the picture big, with its title, tags, note, project and where it came from. */
export function ItemDialog({ item, projects, onClose }: { item: InspirationItem; projects: Project[]; onClose: () => void }) {
  const router = useRouter();
  const { queue, close } = useSave(item.id);
  const [title, setTitle] = useState(item.title);
  const [note, setNote] = useState(item.note);
  const [body, setBody] = useState(item.body);
  const [tags, setTags] = useState(item.tags);
  const [projectId, setProjectId] = useState(item.project?.id ?? "");

  async function done() {
    await close();
    onClose();
  }

  async function remove() {
    try {
      await op("delete_inspiration", { id: item.id });
      onClose();
      router.refresh();
      showTrashedToast("inspiration", item.id, () => router.refresh());
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const field = "w-full bg-transparent text-[16px] outline-none placeholder:text-muted-foreground md:text-sm";

  return (
    <Dialog label={item.title || "Inspiration"} onClose={done} focusFirstField={false} className="sm:max-w-5xl">
      <div className="grid md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative min-w-0 border-b md:border-r md:border-b-0">
          <Media
            item={item}
            body={body}
            onBody={(b) => {
              setBody(b);
              queue({ body: b });
            }}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
          <div className="flex items-start gap-2">
            <textarea
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                queue({ title: e.target.value });
              }}
              rows={1}
              placeholder="Title"
              aria-label="Title"
              className="field-sizing-content grow resize-none bg-transparent text-[17px] leading-snug font-semibold outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={done}
              aria-label="Close"
              className="-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {item.summary && (
            <p className="flex gap-2 text-[13px] leading-relaxed text-muted-foreground">
              <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-label="Claude's description" />
              {item.summary}
            </p>
          )}

          <TagEditor
            tags={tags}
            onChange={(t) => {
              setTags(t);
              queue({ tags: t }, true);
            }}
          />

          <textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              queue({ note: e.target.value });
            }}
            placeholder="Note"
            aria-label="Note"
            rows={3}
            className={`${field} field-sizing-content min-h-20 resize-none rounded-lg border px-3 py-2`}
          />

          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              queue({ projectId: e.target.value || null }, true);
            }}
            aria-label="Project"
            className="h-9 rounded-lg border bg-card px-2 text-[16px] text-foreground shadow-xs md:text-[13px]"
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <div className="flex flex-col gap-1 text-[13px]">
            {item.url && (
              <a href={item.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 py-1 hover:underline">
                <Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{item.site ?? item.url}</span>
                <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              </a>
            )}
            {item.kind === "image" && item.image && (
              <a href={item.image} download={`${item.title || "picture"}.webp`} className="flex items-center gap-2 py-1 hover:underline">
                <Download className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                Download
              </a>
            )}
          </div>

          <div className="mt-auto flex items-center gap-2 pt-2 text-xs text-muted-foreground">
            <span className="grow">
              <MadeByLabel madeBy={item.madeBy} createdAt={item.createdAt} />
            </span>
            <Button variant="danger" size="sm" onClick={remove} className="-mr-2">
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
