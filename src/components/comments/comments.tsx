"use client";

import { Check, MessageSquare, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { editedLabel } from "@/components/notes/note-list";
import { Button } from "@/components/ui/button";
import type { Comment, CommentTarget } from "@/core/comments";
import type { MadeBy } from "@/core/define";
import { COMMENTABLE } from "@/lib/comments";
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

const who = (m: MadeBy) => (m.kind === "user" ? "You" : m.routine ? `${m.name ?? "Claude"} (${m.routine})` : (m.name ?? "Claude"));

/**
 * Comments on a note or an artifact. Pick some words first to quote them.
 * Claude reads open comments through the connector and can reply and resolve them.
 */
export function Comments({
  target,
  threads,
  timeZone,
  currentVersion,
}: {
  target: { type: CommentTarget; id: string };
  threads: Comment[];
  timeZone: string;
  /** Artifacts: the latest version, so older comments can say which version they were on. */
  currentVersion?: number;
}) {
  const router = useRouter();
  const [picked, setPicked] = usePickedWords();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const open = threads.filter((t) => !t.resolved);
  const resolved = threads.filter((t) => t.resolved);

  async function add() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await op("add_comment", { targetType: target.type, targetId: target.id, body, quote: picked ?? undefined });
      setText("");
      setPicked(null);
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Comments" className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="size-4 text-muted-foreground" aria-hidden />
        Comments
        {open.length > 0 && <span className="text-xs font-normal text-muted-foreground">{open.length} open</span>}
      </h2>

      <form
        className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-xs"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        {picked ? (
          <div className="flex items-start gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
            <span className="line-clamp-3 grow italic">“{picked}”</span>
            <button type="button" onClick={() => setPicked(null)} aria-label="Don't quote this" className="shrink-0 hover:text-foreground">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Select some words above to comment on them.</p>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void add();
            }
          }}
          placeholder={target.type === "artifact" ? "Leave a comment for Claude…" : "Leave a comment…"}
          aria-label="New comment"
          rows={2}
          className="field-sizing-content max-h-60 min-h-16 w-full resize-none rounded-lg border bg-background px-3 py-2 text-[16px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40 md:text-[13px]"
        />
        <Button type="submit" size="sm" className="self-end" disabled={busy || !text.trim()}>
          {busy ? "Saving…" : "Comment"}
        </Button>
      </form>

      {open.map((t) => (
        <Thread key={t.id} thread={t} timeZone={timeZone} currentVersion={currentVersion} />
      ))}
      {threads.length === 0 && <p className="px-1 text-xs text-muted-foreground">No comments yet.</p>}
      {resolved.length > 0 && (
        <details className="group flex flex-col gap-3">
          <summary className="cursor-pointer px-1 text-xs text-muted-foreground select-none hover:text-foreground">
            {resolved.length} resolved
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {resolved.map((t) => (
              <Thread key={t.id} thread={t} timeZone={timeZone} currentVersion={currentVersion} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function Thread({ thread, timeZone, currentVersion }: { thread: Comment; timeZone: string; currentVersion?: number }) {
  const router = useRouter();
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const send = () =>
    reply.trim() &&
    run(async () => {
      await op("reply_to_comment", { id: thread.id, body: reply.trim() });
      setReply("");
      setReplying(false);
    });

  return (
    <article className={cn("flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-xs", thread.resolved && "opacity-70")}>
      <Entry entry={thread} timeZone={timeZone} currentVersion={currentVersion} />
      {thread.replies.map((r) => (
        <div key={r.id} className="ml-3 border-l pl-3">
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
              void send();
            }
          }}
          placeholder="Reply…"
          aria-label="Reply"
          rows={2}
          className="field-sizing-content min-h-14 w-full resize-none rounded-lg border bg-background px-3 py-2 text-[16px] outline-none focus:ring-2 focus:ring-ring/40 md:text-[13px]"
        />
      )}
      <div className="flex flex-wrap items-center gap-1">
        {replying ? (
          <>
            <Button size="sm" onClick={send} disabled={busy || !reply.trim()}>
              Reply
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" className="-ml-2" onClick={() => setReplying(true)} disabled={busy}>
            Reply
          </Button>
        )}
        <span className="grow" />
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => run(() => op("resolve_comment", { id: thread.id, resolved: !thread.resolved }))}
        >
          {thread.resolved ? <RotateCcw className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          {thread.resolved ? "Reopen" : "Resolve"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Delete comment"
          title="Delete comment"
          disabled={busy}
          onClick={() => confirm("Delete this comment and its replies?") && run(() => op("delete_comment", { id: thread.id }))}
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
}: {
  entry: Omit<Comment, "replies" | "target">;
  timeZone: string;
  currentVersion?: number;
}) {
  const agent = entry.madeBy.kind === "agent";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
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
        <blockquote className="line-clamp-4 border-l-2 pl-2 text-xs text-muted-foreground italic">{entry.quote}</blockquote>
      )}
      <p className="text-[14px] whitespace-pre-wrap md:text-[13px]">{entry.body}</p>
    </div>
  );
}
