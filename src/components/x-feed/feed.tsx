"use client";

import { Check, Clock, ExternalLink, MessageCircle, Pencil, Repeat2, Send, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { showToast } from "@/components/shell/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { contextMenu } from "@/components/ui/context-menu";
import type { XPost, XReply } from "@/core/x-feed";
import { hide, inBackground, unhide, useHidden, useWithoutHidden } from "@/lib/background";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";

/** X's own limit for accounts without Premium. Longer replies may not post. */
const LIMIT = 280;

export function XFeed({ posts, now, hasPeople }: { posts: XPost[]; now: number; hasPeople: boolean }) {
  const shown = useWithoutHidden(posts);
  const anyNew = posts.some((p) => p.isNew);
  // Opening the feed clears the New dots for next time; they stay up while it's open.
  useEffect(() => {
    if (anyNew) void op("mark_x_feed_seen", {}).catch(() => {});
  }, [anyNew]);

  if (!hasPeople) return <Card className="px-6 py-10 text-center text-control text-muted-foreground">Add people to follow.</Card>;
  if (shown.length === 0) return <Card className="px-6 py-10 text-center text-control text-muted-foreground">No posts yet.</Card>;
  return (
    <Card>
      <ul>
        {shown.map((p) => (
          <PostRow key={p.id} post={p} now={now} />
        ))}
      </ul>
    </Card>
  );
}

function PostRow({ post, now }: { post: XPost; now: number }) {
  const router = useRouter();
  const [replying, setReplying] = useState(false);
  const name = post.person.name || post.person.handle;

  function remove() {
    hide(post.id);
    void inBackground(() => op("delete_x_post", { id: post.id }), {
      then: () => router.refresh(),
      failed: () => unhide(post.id),
      failure: "Couldn't remove the post.",
    });
  }

  const menu = contextMenu(
    () => [
      { label: "Reply", icon: MessageCircle, onSelect: () => setReplying(true) },
      { label: "Open on X", icon: ExternalLink, onSelect: () => window.open(post.url, "_blank", "noreferrer") },
      "-",
      { label: "Remove from feed", icon: Trash2, onSelect: remove },
    ],
    { hold: true },
  );

  return (
    <li className="flex gap-3 border-b px-4 py-4 last:border-b-0" {...menu}>
      <Avatar src={post.person.avatarUrl} name={name} />
      <div className="flex min-w-0 grow flex-col gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5 text-meta">
          <a href={`https://x.com/${post.person.handle}`} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium text-ink hover:underline">
            {name}
          </a>
          <span className="truncate text-muted-foreground">@{post.person.handle}</span>
          <span className="text-muted-foreground" aria-hidden>
            ·
          </span>
          <a href={post.url} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:underline" suppressHydrationWarning>
            {when(new Date(post.postedAt).getTime(), now)}
          </a>
          {post.isNew && <span className="ml-auto size-2 shrink-0 self-center rounded-full bg-unread" aria-label="New" />}
        </div>
        {post.kind === "reply" && post.context?.author && (
          <span className="-mt-1.5 text-meta text-muted-foreground">Replying to {post.context.author}</span>
        )}
        {post.text && <p className="text-body break-words whitespace-pre-wrap text-subtle-foreground">{linkify(post.text)}</p>}
        {post.media.length > 0 && <Media urls={post.media} href={post.url} />}
        {post.kind === "quote" && post.context && (post.context.text || post.context.author) && (
          <a
            href={post.context.url ?? post.url}
            target="_blank"
            rel="noreferrer"
            className="flex flex-col gap-1 rounded-lg border border-stroke px-3 py-2.5 hover:bg-muted/50"
          >
            {post.context.author && (
              <span className="flex items-center gap-1.5 text-meta font-medium text-foreground">
                <Repeat2 className="size-3.5 text-muted-foreground" aria-hidden />
                {post.context.author}
              </span>
            )}
            {post.context.text && <span className="line-clamp-6 text-preview whitespace-pre-wrap text-subtle-foreground">{post.context.text}</span>}
          </a>
        )}
        {post.replies.map((r) => (
          <ReplyRow key={r.id} reply={r} />
        ))}
        {replying ? (
          <Composer postId={post.id} onDone={() => setReplying(false)} />
        ) : (
          <div className="-ml-2 flex">
            <Button variant="ghost" size="sm" onClick={() => setReplying(true)}>
              <MessageCircle aria-hidden />
              Reply
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  // A picture that failed before the page came alive never fires onError, so check once.
  const check = (img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setBroken(true);
  };
  if (!src || broken)
    return (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-control font-medium text-muted-foreground" aria-hidden>
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element -- pictures stay on X's servers
  return <img ref={check} src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-10 shrink-0 rounded-full bg-muted object-cover" />;
}

function Media({ urls, href }: { urls: string[]; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn("grid gap-0.5 overflow-hidden rounded-xl border border-stroke", urls.length > 1 && "grid-cols-2")}>
      {urls.map((u) => (
        // eslint-disable-next-line @next/next/no-img-element -- pictures stay on X's servers
        <img key={u} src={u} alt="" loading="lazy" referrerPolicy="no-referrer" className={cn("w-full bg-muted object-cover", urls.length > 1 ? "aspect-square" : "max-h-[28rem]")} />
      ))}
    </a>
  );
}

const statusLine: Record<XReply["status"], { icon: typeof Clock; label: string }> = {
  draft: { icon: Sparkles, label: "Draft by Claude" },
  queued: { icon: Clock, label: "Waiting to post" },
  sent: { icon: Check, label: "Posted" },
  failed: { icon: TriangleAlert, label: "Couldn't post" },
};

function ReplyRow({ reply }: { reply: XReply }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const gone = useHidden(reply.id);
  if (gone) return null;
  if (editing) return <Composer postId={reply.postId} reply={reply} onDone={() => setEditing(false)} />;
  const { icon: Icon, label } = statusLine[reply.status];

  function send() {
    void inBackground(() => op("update_x_reply", { id: reply.id, send: true }), {
      then: () => {
        showToast("Reply will post on the next check");
        router.refresh();
      },
      failure: "Couldn't send the reply.",
    });
  }

  function cancel() {
    hide(reply.id);
    void inBackground(() => op("delete_x_reply", { id: reply.id }), {
      then: () => router.refresh(),
      failed: () => unhide(reply.id),
      failure: "Couldn't cancel the reply.",
    });
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-muted px-3 py-2.5">
      <p className="text-preview break-words whitespace-pre-wrap text-foreground">{reply.text}</p>
      {reply.status === "failed" && reply.error && <p className="text-meta text-danger">{reply.error}</p>}
      <div className="flex min-h-9 items-center gap-1.5 text-meta text-muted-foreground">
        <Icon className={cn("size-3.5 shrink-0", reply.status === "failed" && "text-danger")} aria-hidden />
        {reply.status === "sent" && reply.replyUrl ? (
          <a href={reply.replyUrl} target="_blank" rel="noreferrer" className="hover:underline">
            {label}
          </a>
        ) : (
          <span className="whitespace-nowrap">{label}</span>
        )}
        <span className="grow" />
        {reply.status !== "sent" && (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit reply"
              className="flex size-9 items-center justify-center rounded-lg hover:bg-selected hover:text-foreground"
            >
              <Pencil className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={cancel}
              aria-label="Cancel reply"
              className="flex size-9 items-center justify-center rounded-lg hover:bg-selected hover:text-foreground"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </>
        )}
        {(reply.status === "draft" || reply.status === "failed") && (
          <Button size="sm" onClick={send}>
            <Send aria-hidden />
            {reply.status === "failed" ? "Try again" : "Send"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Writing a new reply, or changing one that hasn't gone out yet. */
function Composer({ postId, reply, onDone }: { postId: string; reply?: XReply; onDone: () => void }) {
  const router = useRouter();
  const [text, setText] = useState(reply?.text ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  const length = [...text.trim()].length;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Grows with the text.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  function save(e?: React.FormEvent) {
    e?.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    onDone();
    if (reply) {
      if (clean === reply.text) return;
      void inBackground(() => op("update_x_reply", { id: reply.id, text: clean }), { then: () => router.refresh(), failure: "Couldn't save the reply." });
    } else {
      void inBackground(() => op("write_x_reply", { postId, text: clean }), {
        then: () => {
          showToast("Reply will post on the next check");
          router.refresh();
        },
        failure: "Couldn't save the reply.",
      });
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
          if (e.key === "Escape") onDone();
        }}
        rows={2}
        maxLength={4000}
        aria-label="Reply"
        className="min-h-20 resize-none rounded-lg border border-stroke-strong bg-card px-3 py-2 text-body outline-none focus-visible:border-ring md:text-control"
      />
      <div className="flex items-center gap-2">
        <span className={cn("text-meta", length > LIMIT ? "text-danger" : "text-muted-foreground", length < LIMIT - 40 && "invisible")}>{LIMIT - length}</span>
        <span className="grow" />
        <Button variant="ghost" size="sm" onClick={onDone} aria-label="Cancel">
          <X aria-hidden />
        </Button>
        <Button type="submit" size="sm" disabled={!text.trim()}>
          {reply ? "Save" : "Reply"}
        </Button>
      </div>
    </form>
  );
}

/** "5m", "3h", or "20 Nov", like X. */
function when(at: number, now: number) {
  const m = Math.floor((now - at) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(!sameYear && { year: "numeric" }) });
}

/** Web addresses and @names in a post, as links. */
function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+|@[A-Za-z0-9_]{1,15})/g);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part))
      return (
        <a key={i} href={part} target="_blank" rel="noreferrer" className="break-all text-foreground underline decoration-stroke-strong underline-offset-2">
          {part.replace(/^https?:\/\/(www\.)?/, "")}
        </a>
      );
    if (/^@\w+$/.test(part))
      return (
        <a key={i} href={`https://x.com/${part.slice(1)}`} target="_blank" rel="noreferrer" className="text-foreground hover:underline">
          {part}
        </a>
      );
    return part;
  });
}
