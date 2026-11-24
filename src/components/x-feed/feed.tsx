"use client";

import { Bookmark, Check, ChevronLeft, Heart, ChevronRight, Clock, ExternalLink, Filter, Play, MessageCircle, MessageCircleReply, Pencil, Repeat2, Send, Sparkles, Trash2, TriangleAlert, UserCheck, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { showToast } from "@/components/shell/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { contextMenu } from "@/components/ui/context-menu";
import type { XActionKind, XActionState, XPost, XReply } from "@/core/x-feed";
import { hide, inBackground, unhide, useHidden, useWithoutHidden } from "@/lib/background";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";

/** X's own limit for accounts without Premium. Longer replies may not post. */
const LIMIT = 280;

export function XFeed({ posts, now, hasPeople, filtered }: { posts: XPost[]; now: number; hasPeople: boolean; filtered: boolean }) {
  const shown = useWithoutHidden(posts);
  const anyNew = posts.some((p) => p.isNew);
  // Opening the feed clears the New dots for next time; they stay up while it's open.
  useEffect(() => {
    if (anyNew) void op("mark_x_feed_seen", {}).catch(() => {});
  }, [anyNew]);

  if (!hasPeople) return <Card className="px-6 py-10 text-center text-control text-muted-foreground">Add people to follow.</Card>;
  if (shown.length === 0)
    return <Card className="px-6 py-10 text-center text-control text-muted-foreground">{filtered ? "No posts here." : "No posts yet."}</Card>;
  return (
    <ul className="flex flex-col gap-3">
      {shown.map((p) => (
        <PostRow key={p.id} post={p} now={now} />
      ))}
    </ul>
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
      { label: `Only ${name}`, icon: Filter, onSelect: () => router.push(`/x?person=${post.person.id}`, { scroll: false }) },
      "-",
      { label: "Remove from feed", icon: Trash2, onSelect: remove },
    ],
    { hold: true },
  );

  return (
    <li className="flex min-w-0 gap-3 overflow-hidden rounded-xl border border-stroke bg-card px-4 py-4" {...menu}>
      <Avatar src={post.person.avatarUrl} name={name} />
      <div className="flex min-w-0 grow flex-col gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5 text-meta">
          <a href={`https://x.com/${post.person.handle}`} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium text-ink hover:underline">
            {name}
          </a>
          {post.person.engaged && (
            <a
              href={post.person.engaged.lastUrl}
              target="_blank"
              rel="noreferrer"
              title={`Replied to you${post.person.engaged.count > 1 ? ` ${post.person.engaged.count} times lately` : ""}: ${post.person.engaged.lastText}`}
              aria-label="Replied to you"
              className="flex shrink-0 items-center gap-1 self-center rounded-md bg-selected px-1.5 text-meta font-medium text-ink hover:bg-muted"
            >
              <MessageCircleReply className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Replied to you</span>
            </a>
          )}
          {post.person.company && (
            <span className="shrink-0 rounded-md bg-muted px-1.5 text-meta text-subtle-foreground">{post.person.company}</span>
          )}
          <span className="min-w-0 truncate text-muted-foreground">@{post.person.handle}</span>
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
          <Actions post={post} onReply={() => setReplying(true)} />
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

/** X's video and GIF thumbnails live under these folders on its picture server. */
export const isVideoThumb = (u: string) => /\/(ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\//.test(u);
/** The biggest copy X has of a picture. */
const large = (u: string) => (/name=\w+/.test(u) ? u.replace(/name=\w+/, "name=large") : u);

/** Pictures open full screen; videos open on X, where they play. */
function Media({ urls, href }: { urls: string[]; href: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const photos = urls.filter((u) => !isVideoThumb(u));
  return (
    <>
      <div className={cn("grid gap-0.5 overflow-hidden rounded-xl border border-stroke", urls.length > 1 && "grid-cols-2")}>
        {urls.map((u) => {
          const img = (
            // eslint-disable-next-line @next/next/no-img-element -- pictures stay on X's servers
            <img src={u} alt="" loading="lazy" referrerPolicy="no-referrer" className={cn("w-full bg-muted object-cover", urls.length > 1 ? "aspect-square" : "max-h-[28rem]")} />
          );
          return isVideoThumb(u) ? (
            <a key={u} href={href} target="_blank" rel="noreferrer" aria-label="Play video on X" className="relative block">
              {img}
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-black/60 text-white">
                  <Play className="size-6 fill-current" aria-hidden />
                </span>
              </span>
            </a>
          ) : (
            <button key={u} type="button" onClick={() => setOpen(photos.indexOf(u))} aria-label="View picture" className="block cursor-zoom-in">
              {img}
            </button>
          );
        })}
      </div>
      {open !== null && <Viewer photos={photos} start={open} href={href} onClose={() => setOpen(null)} />}
    </>
  );
}

/** A post's pictures full screen: arrows or swipe between them, Escape or a tap outside closes. */
function Viewer({ photos, start, href, onClose }: { photos: string[]; start: number; href: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [i, setI] = useState(start);
  const touch = useRef<number | null>(null);
  const go = (d: number) => setI((n) => (n + d + photos.length) % photos.length);

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const round = "flex size-11 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25";
  return (
    <dialog
      ref={ref}
      aria-label="Picture"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touch.current = null;
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/95 p-0 backdrop:bg-black/80"
    >
      <div className="pointer-events-none flex h-full items-center justify-center p-4 pt-16 pb-[max(env(safe-area-inset-bottom),1rem)]">
        {/* eslint-disable-next-line @next/next/no-img-element -- pictures stay on X's servers */}
        <img src={large(photos[i])} alt="" referrerPolicy="no-referrer" className="pointer-events-auto max-h-full max-w-full object-contain" />
      </div>
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <button type="button" onClick={onClose} aria-label="Close" className={round}>
          <X className="size-5" aria-hidden />
        </button>
        <span className="grow text-center text-meta text-white/70">{photos.length > 1 ? `${i + 1} of ${photos.length}` : ""}</span>
        <a href={href} target="_blank" rel="noreferrer" aria-label="Open on X" className={round}>
          <ExternalLink className="size-5" aria-hidden />
        </a>
      </div>
      {photos.length > 1 && (
        <>
          <button type="button" onClick={() => go(-1)} aria-label="Previous picture" className={cn(round, "absolute top-1/2 left-3 -translate-y-1/2 max-sm:hidden")}>
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next picture" className={cn(round, "absolute top-1/2 right-3 -translate-y-1/2 max-sm:hidden")}>
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </>
      )}
    </dialog>
  );
}

const actionButtons: { kind: XActionKind; icon: typeof Heart; on: string; off: string }[] = [
  { kind: "repost", icon: Repeat2, on: "Undo repost", off: "Repost" },
  { kind: "like", icon: Heart, on: "Unlike", off: "Like" },
  { kind: "bookmark", icon: Bookmark, on: "Remove bookmark", off: "Bookmark" },
];

/**
 * Follow taps made on this page, by person, so every card of theirs shows the same state at once.
 * A tap counts only until the server's copy changes (then the server knows better).
 */
const followTaps = new Map<string, { state: XActionState; base: string }>();
const followListeners = new Set<() => void>();
const key = (s: XActionState) => `${s.on}${s.pending}${s.done}${s.error}`;
function setFollowTap(person: XPost["person"], state: XActionState) {
  followTaps.set(person.id, { state, base: key(person.follow) });
  followListeners.forEach((l) => l());
}
function useFollow(person: XPost["person"]): XActionState {
  const tap = useSyncExternalStore(
    (l) => (followListeners.add(l), () => followListeners.delete(l)),
    () => followTaps.get(person.id),
    () => undefined,
  );
  return tap && tap.base === key(person.follow) ? tap.state : person.follow;
}

/** Reply, repost, like, bookmark and follow. Claude does all but Reply on X at the next check-in. */
function Actions({ post, onReply }: { post: XPost; onReply: () => void }) {
  const router = useRouter();
  const [state, setState] = useState(post.actions);
  const follow = useFollow(post.person);

  function toggleFollow() {
    const was = follow;
    const on = !was.on;
    setFollowTap(post.person, { on, pending: on !== was.done, error: null, done: was.done });
    void inBackground(() => op("set_x_follow", { personId: post.person.id, on }), {
      then: () => router.refresh(),
      failed: () => setFollowTap(post.person, was),
      failure: "Couldn't save that.",
    });
  }

  function toggle(kind: XActionKind) {
    const was = state[kind];
    const on = !was.on;
    // Undoing something not yet done on X just cancels it: nothing left to wait for.
    setState((s) => ({ ...s, [kind]: { on, pending: on !== was.done, error: null, done: was.done } }));
    void inBackground(() => op("set_x_post_action", { postId: post.id, kind, on }), {
      then: () => router.refresh(),
      failed: () => setState((s) => ({ ...s, [kind]: was })),
      failure: "Couldn't save that.",
    });
  }

  const button = "relative flex h-9 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-meta text-muted-foreground hover:bg-muted hover:text-foreground";
  return (
    <div className="-ml-2 flex items-center gap-1">
      <button type="button" onClick={onReply} className={button}>
        <MessageCircle className="size-4" aria-hidden />
        Reply
      </button>
      {actionButtons.map(({ kind, icon: Icon, on, off }) => {
        const a: XActionState = state[kind];
        const label = a.on ? on : off;
        return (
          <button
            key={kind}
            type="button"
            onClick={() => toggle(kind)}
            aria-pressed={a.on}
            aria-label={a.pending ? `${label} (at the next check-in)` : label}
            title={a.error ?? (a.pending ? "Happens on X at the next check-in" : label)}
            className={cn(button, a.on && "text-ink", a.pending && "opacity-60")}
          >
            <Icon className={cn("size-4", a.on && "fill-current")} aria-hidden />
            {a.pending && <Clock className="absolute top-1 right-1 size-2.5" aria-hidden />}
            {a.error && <TriangleAlert className="absolute top-1 right-1 size-2.5 text-danger" aria-hidden />}
          </button>
        );
      })}
      {(() => {
        const name = post.person.name || `@${post.person.handle}`;
        const label = follow.on ? `Unfollow ${name}` : `Follow ${name}`;
        const Icon = follow.on ? UserCheck : UserPlus;
        return (
          <button
            type="button"
            onClick={toggleFollow}
            aria-pressed={follow.on}
            aria-label={follow.pending ? `${label} (at the next check-in)` : label}
            title={follow.error ?? (follow.pending ? "Happens on X at the next check-in" : label)}
            className={cn(button, follow.on && "text-ink", follow.pending && "opacity-60")}
          >
            <Icon className="size-4" aria-hidden />
            {follow.pending && <Clock className="absolute top-1 right-1 size-2.5" aria-hidden />}
            {follow.error && <TriangleAlert className="absolute top-1 right-1 size-2.5 text-danger" aria-hidden />}
          </button>
        );
      })()}
    </div>
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
