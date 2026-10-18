"use client";

import { Check, MapPin, MessageSquare, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { editedLabel } from "@/components/notes/note-list";
import { Button } from "@/components/ui/button";
import type { Comment, CommentTarget } from "@/core/comments";
import type { MadeBy } from "@/core/define";
import type { CommentPin } from "@/db/schema";
import { COMMENTABLE } from "@/lib/comments";
import { hide, inBackground, unhide, useWithoutHidden } from "@/lib/background";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";


/**
 * Remembers the words last picked inside the note or artifact, so a comment
 * can quote them even after the selection is lost by clicking the comment box.
 */
function usePickedWords() {
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    const onChange = () => {
      const selection = document.getSelection();
      const text = selection?.toString().trim();
      const node = selection?.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      if (text && el?.closest(`[${COMMENTABLE}]`)) setPicked(text.slice(0, 2000));
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);
  return [picked, setPicked] as const;
}

type CommentEntry = Omit<Comment, "replies" | "target">;

/** A comment Luke just wrote, shown at once while it saves. `saved` once the server has it. */
function draftEntry(body: string, quote: string | null, pin: CommentPin | null = null): CommentEntry & { saved?: boolean } {
  return {
    id: `pending-${Date.now()}`,
    version: null,
    quote,
    pin,
    body,
    resolved: false,
    resolvedAt: null,
    madeBy: { kind: "user", name: null, routine: null },
    createdAt: new Date(),
  };
}

const who = (m: MadeBy) => (m.kind === "user" ? "You" : m.routine ? `${m.name ?? "Claude"} (${m.routine})` : (m.name ?? "Claude"));

/**
 * Comments on a note, an artifact, a task, a Work archive entry or a whiteboard. Pick some words first to quote them.
 * Claude reads open comments through the connector and can reply and resolve them.
 */
export function Comments({
  target,
  threads,
  timeZone,
  currentVersion,
  onChanged,
  pin,
  onUnpin,
  numbers,
  active,
  onPick,
}: {
  target: { type: CommentTarget; id: string };
  threads: Comment[];
  timeZone: string;
  /** Artifacts: the latest version, so older comments can say which version they were on. */
  currentVersion?: number;
  /** Reloads the threads after a change. Defaults to refreshing the page. */
  onChanged?: () => void;
  /** Whiteboards: the spot the next comment is pinned to. */
  pin?: CommentPin | null;
  onUnpin?: () => void;
  /** Whiteboards: each pinned thread's number, as shown on the board. */
  numbers?: Map<string, number>;
  /** The thread picked on the board, shown and scrolled to. */
  active?: string | null;
  /** Picking a pinned thread's number, to find it on the board. */
  onPick?: (thread: Comment) => void;
}) {
  const router = useRouter();
  const changed = onChanged ?? (() => router.refresh());
  const [picked, setPicked] = usePickedWords();
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (pin) box.current?.focus();
  }, [pin]);
  // New comments and resolve/reopen show at once; the server catches up behind them.
  const [pending, setPending] = useState<(Comment & { saved?: boolean })[]>([]);
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [seen, setSeen] = useState(threads);
  if (seen !== threads) {
    // Fresh comments from the server: anything saved is in them now.
    setSeen(threads);
    setPending((p) => p.filter((c) => !c.saved));
    setFlipped({});
  }
  const all = useWithoutHidden([...threads, ...pending]).map((t) => (t.id in flipped ? { ...t, resolved: flipped[t.id] } : t));
  const open = all.filter((t) => !t.resolved);
  const resolved = all.filter((t) => t.resolved);

  function add() {
    const body = text.trim();
    if (!body) return;
    const quote = picked;
    const spot = pin ?? null;
    const entry = { ...draftEntry(body, quote, spot), target: { ...target, title: "" }, replies: [] };
    setPending((p) => [...p, entry]);
    setText("");
    setPicked(null);
    onUnpin?.();
    void inBackground(() => op("add_comment", { targetType: target.type, targetId: target.id, body, quote: quote ?? undefined, pin: spot ?? undefined }), {
      then: () => {
        setPending((p) => p.map((c) => (c.id === entry.id ? { ...c, saved: true } : c)));
        changed();
      },
      failed: () => {
        setPending((p) => p.filter((c) => c.id !== entry.id));
        setText((t) => t || body);
      },
      failure: "Couldn't save the comment.",
    });
  }

  function resolve(thread: Comment, next: boolean) {
    setFlipped((f) => ({ ...f, [thread.id]: next }));
    void inBackground(() => op("resolve_comment", { id: thread.id, resolved: next }), {
      then: changed,
      failed: () => setFlipped((f) => Object.fromEntries(Object.entries(f).filter(([id]) => id !== thread.id))),
    });
  }

  function remove(thread: Comment) {
    if (!confirm("Delete this comment and its replies?")) return;
    hide(thread.id);
    void inBackground(() => op("delete_comment", { id: thread.id }), { then: changed, failed: () => unhide(thread.id) });
  }

  const threadProps = { timeZone, currentVersion, onChanged: changed, onResolve: resolve, onRemove: remove, numbers, active, onPick };

  return (
    <section aria-label="Comments" className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <MessageSquare className="size-4 text-muted-foreground" aria-hidden />
        Comments
        {open.length > 0 && <span className="text-xs font-normal text-muted-foreground">{open.length} open</span>}
      </h2>

      <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 border-stroke">
        {picked ? (
          <div className="flex items-start gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-meta text-muted-foreground">
            <span className="line-clamp-3 grow italic">“{picked}”</span>
            <button type="button" onClick={() => setPicked(null)} aria-label="Don't quote this" className="shrink-0 hover:text-foreground">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : null}
        {pin ? (
          <div className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-meta text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <span className="grow">Pinned to the board</span>
            <button type="button" onClick={onUnpin} aria-label="Don't pin it" className="shrink-0 hover:text-foreground">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : null}
        <textarea
          ref={box}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              add();
            }
          }}
          placeholder={target.type === "note" || target.type === "entry" || target.type === "whiteboard" ? "Leave a comment…" : "Leave a comment for Claude…"}
          aria-label="New comment"
          rows={2}
          className="field-sizing-content max-h-60 min-h-16 w-full resize-none rounded-lg border bg-background px-3 py-2 text-body outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40 md:text-meta"
        />
        <Button size="sm" className="self-end" onClick={add} disabled={!text.trim()}>
          Comment
        </Button>
      </div>

      {open.map((t) => (
        <Thread key={t.id} thread={t} {...threadProps} />
      ))}
      {all.length === 0 && <p className="px-1 text-meta text-muted-foreground">No comments yet.</p>}
      {resolved.length > 0 && (
        <details className="group flex flex-col gap-3">
          <summary className="cursor-pointer px-1 text-meta text-muted-foreground select-none hover:text-foreground">
            {resolved.length} resolved
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {resolved.map((t) => (
              <Thread key={t.id} thread={t} {...threadProps} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function Thread({
  thread,
  timeZone,
  currentVersion,
  onChanged,
  onResolve,
  onRemove,
  numbers,
  active,
  onPick,
}: {
  thread: Comment & { saved?: boolean };
  timeZone: string;
  currentVersion?: number;
  onChanged: () => void;
  onResolve: (thread: Comment, resolved: boolean) => void;
  onRemove: (thread: Comment) => void;
  numbers?: Map<string, number>;
  active?: string | null;
  onPick?: (thread: Comment) => void;
}) {
  const here = useRef<HTMLElement>(null);
  const isActive = active === thread.id;
  useEffect(() => {
    if (isActive) here.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [isActive]);
  const number = numbers?.get(thread.id);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  // A comment still on its way to the server can't be answered or changed yet.
  const saving = thread.id.startsWith("pending-");
  const [pending, setPending] = useState<(CommentEntry & { saved?: boolean })[]>([]);
  const [seen, setSeen] = useState(thread.replies);
  if (seen !== thread.replies) {
    setSeen(thread.replies);
    setPending((p) => p.filter((r) => !r.saved));
  }

  function send() {
    const body = reply.trim();
    if (!body) return;
    const entry = draftEntry(body, null);
    setPending((p) => [...p, entry]);
    setReply("");
    setReplying(false);
    void inBackground(() => op("reply_to_comment", { id: thread.id, body }), {
      then: () => {
        setPending((p) => p.map((r) => (r.id === entry.id ? { ...r, saved: true } : r)));
        onChanged();
      },
      failed: () => {
        setPending((p) => p.filter((r) => r.id !== entry.id));
        setReply((t) => t || body);
        setReplying(true);
      },
      failure: "Couldn't save the reply.",
    });
  }

  return (
    <article
      ref={here}
      aria-busy={saving}
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-card p-3 border-stroke",
        isActive && "border-foreground",
        (thread.resolved || saving) && "opacity-70",
      )}
    >
      <Entry
        entry={thread}
        timeZone={timeZone}
        currentVersion={currentVersion}
        pin={
          number !== undefined ? (
            <button
              type="button"
              onClick={() => onPick?.(thread)}
              title="Show on the board"
              aria-label={`Show comment ${number} on the board`}
              className="flex size-5 shrink-0 items-center justify-center rounded-full rounded-bl-none bg-foreground text-tag font-medium text-background tabular-nums"
            >
              {number}
            </button>
          ) : null
        }
      />
      {[...thread.replies, ...pending].map((r) => (
        <div key={r.id} className={cn("ml-3 border-l pl-3", r.id.startsWith("pending-") && "opacity-60")}>
          <Entry entry={r} timeZone={timeZone} currentVersion={currentVersion} />
        </div>
      ))}
      {replying && (
        <textarea
          autoFocus
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Reply…"
          aria-label="Reply"
          rows={2}
          className="field-sizing-content min-h-14 w-full resize-none rounded-lg border bg-background px-3 py-2 text-body outline-none focus:ring-2 focus:ring-ring/40 md:text-meta"
        />
      )}
      <div className="flex flex-wrap items-center gap-1">
        {replying ? (
          <>
            <Button size="sm" onClick={send} disabled={!reply.trim()}>
              Reply
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" className="-ml-2" onClick={() => setReplying(true)} disabled={saving}>
            Reply
          </Button>
        )}
        <span className="grow" />
        <Button
          size="sm"
          variant="ghost"
          disabled={saving}
          onClick={() => onResolve(thread, !thread.resolved)}
        >
          {thread.resolved ? <RotateCcw className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          {thread.resolved ? "Reopen" : "Resolve"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Delete comment"
          title="Delete comment"
          disabled={saving}
          onClick={() => onRemove(thread)}
          className="-mr-2"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </Button>
      </div>
    </article>
  );
}

function Entry({
  entry,
  timeZone,
  currentVersion,
  pin,
}: {
  entry: Omit<Comment, "replies" | "target">;
  timeZone: string;
  currentVersion?: number;
  /** Whiteboards: the pinned thread's number. */
  pin?: React.ReactNode;
}) {
  const agent = entry.madeBy.kind === "agent";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 text-meta text-muted-foreground">
        {pin}
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          {agent && <Sparkles className="size-3" aria-hidden />}
          {who(entry.madeBy)}
        </span>
        <span>{editedLabel(new Date(entry.createdAt), timeZone)}</span>
        {currentVersion !== undefined && entry.version !== null && entry.version !== currentVersion && (
          <span>on version {entry.version}</span>
        )}
      </div>
      {entry.quote && (
        <blockquote className="line-clamp-4 border-l-2 pl-2 text-meta text-muted-foreground italic">{entry.quote}</blockquote>
      )}
      <p className="text-preview whitespace-pre-wrap md:text-meta">{entry.body}</p>
    </div>
  );
}
