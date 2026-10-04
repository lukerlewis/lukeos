"use client";

import { Archive, ArrowUp, Check, Lightbulb, Bot, CheckSquare, FileText, Folder, MoreHorizontal, Plus, Repeat, Reply, Sparkles, NotebookPen, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { showToast } from "@/components/shell/toast";
import { useTaskEditor } from "@/components/tasks/task-editor";
import { friendlyDay, todayIn } from "@/lib/dates";
import { attachmentKind, MAX_ATTACHMENTS } from "@/lib/message-files";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import {
  asThreadAttachment,
  MessageAttachments,
  PendingTray,
  PhotoViewer,
  uploadAttachment,
  type Pending,
  type ThreadAttachment,
} from "./attachments";
import { MessageMenu, messageRect, type MenuAnchor } from "./message-menu";
import { MESSAGES_READ_EVENT } from "./unread";

export type ThreadMessage = {
  id: string;
  text: string;
  attachments: ThreadAttachment[];
  from: "luke" | "claude";
  /** "End of day recap", when a routine sent it. */
  routine: string | null;
  link: { type: "task" | "note" | "document" | "artifact" | "project" | "routine" | "entry" | "inspiration"; id: string; title: string } | null;
  createdAt: string;
  answered: boolean;
  edited: boolean;
  /** Unsent: shown as a quiet line in its place. */
  unsent: boolean;
  /** The earlier message this replies to, quoted above it. */
  replyTo: { id: string; from: "luke" | "claude" | null; snippet: string; unavailable: boolean } | null;
};

/** Messages more than this far apart get their own time line, like iMessage. */
const GAP_MS = 60 * 60_000;
/** How long a press has to be held on a phone to open a message's menu. */
const HOLD_MS = 450;

/**
 * The Messages chain: Luke's texts on the right, Claude's on the left in
 * grey, with a box at the bottom to write a new one and attach photos,
 * videos and files.
 */
export function MessageThread({
  messages,
  timeZone,
  nextCheckIn,
  unread,
}: {
  messages: ThreadMessage[];
  timeZone: string;
  /** "2pm", "Tomorrow 5am": when Claude will next read new messages. */
  nextCheckIn: string | null;
  unread: number;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [sending, setSending] = useState<ThreadMessage[]>([]);
  const [photo, setPhoto] = useState<ThreadAttachment | null>(null);
  const closePhoto = useCallback(() => setPhoto(null), []);
  // Edits and unsends show straight away, before the screen reloads.
  const [changed, setChanged] = useState<Record<string, Partial<ThreadMessage>>>({});
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [editing, setEditing] = useState<ThreadMessage | null>(null);
  const [replying, setReplying] = useState<ThreadMessage | null>(null);
  // The message a quote was tapped to jump to, lit up for a moment.
  const [flash, setFlash] = useState<string | null>(null);
  const shown = [...messages, ...sending.filter((s) => !messages.some((m) => m.id === s.id))].map((m) =>
    changed[m.id] ? { ...m, ...changed[m.id] } : m,
  );
  const change = (id: string, patch: Partial<ThreadMessage> | null) =>
    setChanged((all) => {
      const next = { ...all };
      if (patch) next[id] = { ...next[id], ...patch };
      else delete next[id];
      return next;
    });

  // Press and hold a message on a phone to open its menu.
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const held = useRef(false);
  const openMenu = (el: HTMLElement) => {
    const id = el.dataset.msg;
    if (id) setMenu({ id, rect: messageRect(el) });
  };
  const cancelHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };

  function jumpTo(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) {
      showToast("That message is too far back to show");
      return;
    }
    el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1400);
  }

  async function unsend(m: ThreadMessage) {
    if (editing?.id === m.id) setEditing(null);
    if (replying?.id === m.id) setReplying(null);
    change(m.id, { unsent: true });
    try {
      await op("unsend_message", { id: m.id });
      showToast("Message unsent", async () => {
        await op("restore_from_trash", { type: "message", id: m.id });
        change(m.id, null);
      });
      router.refresh();
    } catch (err) {
      change(m.id, null);
      alert((err as Error).message);
    }
  }

  async function saveEdit(m: ThreadMessage, text: string) {
    setEditing(null);
    if (text === m.text) return;
    change(m.id, { text, edited: true });
    try {
      await op("edit_message", { id: m.id, text });
      router.refresh();
    } catch (err) {
      change(m.id, null);
      alert((err as Error).message);
    }
  }

  // Opening Messages marks Claude's texts as seen and clears the app icon's number.
  useEffect(() => {
    if ("clearAppBadge" in navigator) navigator.clearAppBadge().catch(() => {});
    if (unread === 0) return;
    op("mark_messages_read", {})
      .then(() => window.dispatchEvent(new Event(MESSAGES_READ_EVENT)))
      .catch(() => {});
  }, [unread]);

  // Open at the newest message. Next.js scrolls a newly opened screen back to
  // the top just after this runs, and the notifications banner can appear above
  // the chain a moment later, so hold the bottom until the screen settles or
  // Luke scrolls himself. Runs before the first paint, so there's no visible jump.
  useLayoutEffect(() => {
    const toEnd = () => endRef.current?.scrollIntoView({ block: "end" });
    toEnd();
    const frame = requestAnimationFrame(toEnd);
    const resize = new ResizeObserver(toEnd);
    const area = rootRef.current?.parentElement;
    if (area) resize.observe(area);
    const stop = () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      clearTimeout(timer);
      for (const e of ["wheel", "touchstart", "keydown"]) window.removeEventListener(e, stop);
    };
    const timer = setTimeout(stop, 1500);
    for (const e of ["wheel", "touchstart", "keydown"]) window.addEventListener(e, stop, { passive: true });
    return stop;
  }, []);

  // Follow new messages as they arrive.
  const count = useRef(shown.length);
  useLayoutEffect(() => {
    if (shown.length === count.current) return;
    count.current = shown.length;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [shown.length]);

  // Look for Claude's replies when coming back to the app.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  const today = todayIn(timeZone);
  const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  // "1:05pm", like times elsewhere in LukeOS.
  const time = (at: Date) => hourFmt.format(at).replace(/\s?([AP])M$/i, (_, x: string) => `${x.toLowerCase()}m`);
  const lastLuke = shown.findLastIndex((m) => m.from === "luke" && !m.unsent);
  const waiting = lastLuke >= 0 && !shown[lastLuke].answered && !shown.slice(lastLuke + 1).some((m) => m.from === "claude");

  return (
    <div ref={rootRef} className="flex grow flex-col">
      {shown.length === 0 ? (
        <div className="mx-auto flex max-w-sm flex-col items-center gap-2 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Sparkles className="size-5 text-muted-foreground" aria-hidden />
          </span>
          <p className="font-medium">Text Claude anything</p>
        </div>
      ) : (
        <ol
          className="mx-auto flex w-full max-w-2xl flex-col gap-1 pb-2"
          aria-label="Messages"
          onPointerDown={(e) => {
            if (e.pointerType === "mouse") return;
            const el = (e.target as Element).closest<HTMLElement>("[data-msg]");
            if (!el) return;
            cancelHold();
            hold.current = {
              x: e.clientX,
              y: e.clientY,
              timer: setTimeout(() => {
                hold.current = null;
                held.current = true;
                navigator.vibrate?.(10);
                openMenu(el);
              }, HOLD_MS),
            };
          }}
          onPointerMove={(e) => {
            if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 8) cancelHold();
          }}
          onPointerUp={cancelHold}
          onPointerCancel={cancelHold}
          onContextMenu={(e) => {
            const el = (e.target as Element).closest<HTMLElement>("[data-msg]");
            if (!el) return;
            e.preventDefault();
            cancelHold();
            openMenu(el);
          }}
          // The tap that ends a press and hold doesn't also open a photo or link.
          onClickCapture={(e) => {
            if (!held.current) return;
            held.current = false;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {shown.map((m, i) => {
            const prev = shown[i - 1];
            const at = new Date(m.createdAt);
            const newTime = !prev || at.getTime() - new Date(prev.createdAt).getTime() > GAP_MS;
            const sameSender = prev && !newTime && prev.from === m.from && !prev.unsent;
            const mine = m.from === "luke";
            const pending = m.id.startsWith("sending-");
            const actionable = !pending && !m.unsent;
            // An original unsent since the screen loaded shows as unavailable straight away.
            const quoted = m.replyTo && (m.replyTo.unavailable || shown.find((x) => x.id === m.replyTo!.id)?.unsent)
              ? { ...m.replyTo, unavailable: true }
              : m.replyTo;
            return (
              <Fragment key={m.id}>
                {newTime && (
                  <li className="pt-4 pb-1.5 text-center text-[12px] text-muted-foreground" aria-hidden>
                    <span className="font-medium">{friendlyDay(todayIn(timeZone, at), today)}</span> {time(at)}
                  </li>
                )}
                {m.unsent ? (
                  <li className="py-1.5 text-center text-[12px] text-muted-foreground">{mine ? "You" : "Claude"} unsent a message</li>
                ) : (
                <li
                  id={`msg-${m.id}`}
                  data-msg={actionable ? m.id : undefined}
                  onMouseEnter={
                    actionable
                      ? (e) => {
                          // Sit the ⋯ button just beside the message (left of Luke's, right of Claude's), however wide it is.
                          const li = e.currentTarget;
                          const r = messageRect(li);
                          const box = li.getBoundingClientRect();
                          li.style.setProperty("--msg-left", `${r.left - box.left}px`);
                          li.style.setProperty("--msg-right", `${r.right - box.left}px`);
                        }
                      : undefined
                  }
                  className={cn(
                    "flex flex-col",
                    mine ? "items-end" : "items-start",
                    !sameSender && !newTime && "mt-2",
                    actionable && "group relative pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]",
                    "transition-[transform,background-color] duration-300",
                    menu?.id === m.id && (mine ? "origin-right scale-[1.02]" : "origin-left scale-[1.02]"),
                    editing?.id === m.id && "opacity-60",
                    flash === m.id && "rounded-2xl bg-muted/70",
                  )}
                >
                  {!mine && m.routine && (!sameSender || prev.routine !== m.routine) && (
                    <span className="px-3 pb-0.5 text-[11px] text-muted-foreground">{m.routine}</span>
                  )}
                  {quoted && <Quote quote={quoted} mine={mine} onJump={jumpTo} />}
                  {m.attachments.length > 0 && (
                    <MessageAttachments attachments={m.attachments} mine={mine} pending={pending} onOpen={setPhoto} />
                  )}
                  {m.text && (
                    <div
                      title={time(at)}
                      className={cn(
                        "max-w-[80%] rounded-[20px] px-3.5 py-2 text-[16px] leading-snug break-words whitespace-pre-wrap md:max-w-[70%] md:text-[15px]",
                        mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                        pending && "opacity-60",
                      )}
                    >
                      <span className="sr-only">{mine ? "You" : "Claude"}, {time(at)}: </span>
                      <Linkified text={m.text} mine={mine} />
                    </div>
                  )}
                  {m.link && <LinkCard link={m.link} mine={mine} />}
                  {m.edited && <span className="px-1 pt-0.5 text-[11px] text-muted-foreground">Edited</span>}
                  {actionable && (
                    <button
                      type="button"
                      data-menu-ignore
                      aria-label="Message options"
                      onClick={(e) => openMenu(e.currentTarget.parentElement!)}
                      style={{ left: mine ? "calc(var(--msg-left, 0px) - 2.25rem)" : "calc(var(--msg-right, 0px) + 0.5rem)" }}
                      className="absolute top-1/2 hidden size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100 pointer-fine:flex"
                    >
                      <MoreHorizontal className="size-4" aria-hidden />
                    </button>
                  )}
                </li>
                )}
              </Fragment>
            );
          })}
          {waiting && (
            <li className="px-1 pt-1 text-right text-[12px] text-muted-foreground">
              {shown[lastLuke].id.startsWith("sending-")
                ? "Sending…"
                : nextCheckIn
                  ? `Delivered · Claude reads it at ${nextCheckIn}`
                  : "Delivered · Claude reads it at the next check-in"}
            </li>
          )}
        </ol>
      )}
      {menu &&
        (() => {
          const m = shown.find((x) => x.id === menu.id);
          if (!m) return null;
          return (
            <MessageMenu
              anchor={menu}
              mine={m.from === "luke"}
              canEdit={m.text.length > 0}
              canCopy={m.text.length > 0}
              onClose={closeMenu}
              onReply={() => {
                setEditing(null);
                setReplying(m);
                // Keep the newest message in view above the taller box.
                requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
              }}
              onEdit={() => {
                setReplying(null);
                setEditing(m);
              }}
              onCopy={() => navigator.clipboard?.writeText(m.text).then(() => showToast("Copied"), () => {})}
              onUnsend={() => void unsend(m)}
            />
          );
        })()}
      <Composer
        editing={editing}
        replying={replying}
        onCancelEdit={() => setEditing(null)}
        onCancelReply={() => setReplying(null)}
        onSaveEdit={(m, text) => void saveEdit(m, text)}
        onSending={(m) => {
          setReplying(null);
          setSending((s) => [...s, m]);
        }}
        onSent={(tempId, real) =>
          setSending((s) => (real ? s.map((x) => (x.id === tempId ? real : x)) : s.filter((x) => x.id !== tempId)))
        }
      />
      {/* Below the box (and clear of the phone tab bar), so scrolling to it shows the last message above the box, not behind it. */}
      <div ref={endRef} className="scroll-mb-[calc(3.5rem+env(safe-area-inset-bottom))] md:scroll-mb-0" />
      <PhotoViewer photo={photo} onClose={closePhoto} />
    </div>
  );
}

function Composer({
  editing,
  replying,
  onCancelEdit,
  onCancelReply,
  onSaveEdit,
  onSending,
  onSent,
}: {
  /** One of Luke's messages being changed: the box holds its text until he saves or cancels. */
  editing: ThreadMessage | null;
  /** The message Luke is replying to, shown above the box until he sends or cancels. */
  replying: ThreadMessage | null;
  onCancelEdit: () => void;
  onCancelReply: () => void;
  onSaveEdit: (m: ThreadMessage, text: string) => void;
  onSending: (m: ThreadMessage) => void;
  onSent: (tempId: string, real: ThreadMessage | null) => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Pending[]>([]);
  const [, startTransition] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);

  // The box grows with what's typed, up to a few lines.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  // Editing swaps what's being written for the message's text, and puts it back after.
  const draft = useRef("");
  const editingId = editing?.id ?? null;
  useEffect(() => {
    if (!editing) return;
    setText((current) => {
      draft.current = current;
      return editing.text;
    });
    const el = box.current;
    if (el) {
      el.focus();
      requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
    }
    return () => setText(draft.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  // Starting a reply puts the cursor in the box.
  const replyingId = replying?.id ?? null;
  useEffect(() => {
    if (replyingId) box.current?.focus();
  }, [replyingId]);

  const update = (key: string, change: Partial<Pending>) =>
    setPicked((list) => list.map((p) => (p.key === key ? { ...p, ...change } : p)));

  /** Starts uploading picked files straight away, so sending is quick. */
  function add(files: File[]) {
    const room = MAX_ATTACHMENTS - picked.length;
    if (files.length > room) alert(`Up to ${MAX_ATTACHMENTS} things per message.`);
    const fresh = files.slice(0, Math.max(0, room)).map<Pending>((file) => ({
      key: crypto.randomUUID(),
      file,
      preview: attachmentKind(file.type) === "file" ? null : URL.createObjectURL(file),
      progress: 0,
      uploaded: null,
      error: null,
    }));
    setPicked((list) => [...list, ...fresh]);
    for (const p of fresh)
      uploadAttachment(p.file, (progress) => update(p.key, { progress }))
        .then((uploaded) => update(p.key, { uploaded, progress: 1 }))
        .catch((err: Error) => {
          update(p.key, { error: err.message });
          alert(err.message);
        });
  }

  function remove(key: string) {
    setPicked((list) => {
      const gone = list.find((p) => p.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return list.filter((p) => p.key !== key);
    });
  }

  const ready = picked.filter((p) => p.uploaded);
  const uploading = picked.some((p) => !p.uploaded && !p.error);
  const canSend = !uploading && (text.trim().length > 0 || ready.length > 0);

  function send() {
    const clean = text.trim();
    if (editing) {
      if (!clean && !editing.attachments.length) return;
      draft.current = "";
      onSaveEdit(editing, clean);
      return;
    }
    if (!canSend) return;
    const tempId = `sending-${Date.now()}`;
    const files = ready.map((p) => p.uploaded!);
    const kept = picked;
    onSending({
      id: tempId,
      text: clean,
      attachments: files.map(asThreadAttachment),
      from: "luke",
      routine: null,
      link: null,
      createdAt: new Date().toISOString(),
      answered: false,
      edited: false,
      unsent: false,
      replyTo: replying ? { id: replying.id, from: replying.from, snippet: snippetOf(replying), unavailable: false } : null,
    });
    setText("");
    setPicked([]);
    startTransition(async () => {
      try {
        const sent = await op("send_message", {
          ...(clean && { text: clean }),
          ...(replying && { replyTo: replying.id }),
          ...(files.length && {
            attachments: files.map((f) => ({ fileId: f.fileId, thumbId: f.thumbId, name: f.name, width: f.width, height: f.height })),
          }),
        });
        onSent(tempId, { ...sent, routine: null, createdAt: new Date(sent.createdAt).toISOString(), edited: false, unsent: false, replyTo: sent.replyTo });
        for (const p of kept) if (p.preview) URL.revokeObjectURL(p.preview);
        router.refresh();
      } catch (err) {
        onSent(tempId, null);
        setText(clean);
        setPicked(kept);
        alert((err as Error).message);
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        add([...e.dataTransfer.files]);
      }}
      className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-[5] -mx-5 mt-auto border-t bg-background/95 px-3 py-2 backdrop-blur md:bottom-0 md:mx-0 md:border-0 md:px-0 md:pb-6"
    >
      {editing ? (
        <div className="mx-auto flex max-w-2xl items-center gap-2 pb-1.5 pl-1 text-[13px] text-muted-foreground">
          <span className="grow truncate">Editing message</span>
          <button
            type="button"
            onClick={onCancelEdit}
            aria-label="Cancel editing"
            className="flex size-7 items-center justify-center rounded-full hover:bg-muted"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : (
        <>
          {replying && (
            <div className="mx-auto flex max-w-2xl items-center gap-2 pb-1.5 pl-1">
              <Reply className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 grow border-l-2 pl-2 text-[13px] leading-snug">
                <div className="font-medium">{replying.from === "luke" ? "You" : "Claude"}</div>
                <div className="truncate text-muted-foreground">{snippetOf(replying)}</div>
              </div>
              <button
                type="button"
                onClick={onCancelReply}
                aria-label="Cancel reply"
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          )}
          <PendingTray items={picked} onRemove={remove} />
        </>
      )}
      <div className="mx-auto flex max-w-2xl items-end gap-2">
        <button
          type="button"
          onClick={() => filePicker.current?.click()}
          aria-label="Add photos or files"
          className={cn("mb-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground", editing && "hidden")}
        >
          <Plus className="size-[18px]" strokeWidth={2.5} aria-hidden />
        </button>
        <input
          ref={filePicker}
          type="file"
          multiple
          hidden
          className="text-[16px]"
          onChange={(e) => {
            if (e.target.files?.length) add([...e.target.files]);
            e.target.value = "";
          }}
        />
        <textarea
          ref={box}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (editing) return;
            const files = [...e.clipboardData.files];
            if (!files.length) return;
            e.preventDefault();
            add(files);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && (editing || replying)) {
              e.preventDefault();
              if (editing) onCancelEdit();
              else onCancelReply();
              return;
            }
            // Enter sends on a computer; Shift+Enter (and the phone's return key) starts a new line.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Message Claude"
          aria-label="Message Claude"
          className="min-h-10 grow resize-none rounded-[20px] border bg-card px-4 py-2 text-[16px] leading-snug outline-none placeholder:text-muted-foreground focus:border-ring md:text-[15px]"
        />
        <button
          type="submit"
          disabled={editing ? !text.trim() && !editing.attachments.length : !canSend}
          aria-label={editing ? "Save" : "Send"}
          className="mb-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
        >
          {editing ? (
            <Check className="size-[18px]" strokeWidth={2.5} aria-hidden />
          ) : (
            <ArrowUp className="size-[18px]" strokeWidth={2.5} aria-hidden />
          )}
        </button>
      </div>
    </form>
  );
}

/** The start of a message, for a reply's quote: its words, or what was sent if it was only files. */
function snippetOf(m: ThreadMessage) {
  const flat = m.text.replace(/\s+/g, " ").trim();
  if (flat) return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
  const kinds = new Set(m.attachments.map((a) => a.kind));
  const what = kinds.size > 1 ? "file" : kinds.has("image") ? "photo" : kinds.has("video") ? "video" : "file";
  return m.attachments.length > 1 ? `${m.attachments.length} ${what}s` : what === "photo" ? "Photo" : what === "video" ? "Video" : "File";
}

/** The message a reply answers, quoted small above it. Tapping it jumps to the original. */
function Quote({ quote, mine, onJump }: { quote: NonNullable<ThreadMessage["replyTo"]>; mine: boolean; onJump: (id: string) => void }) {
  const cls = cn(
    "mb-0.5 flex max-w-[75%] flex-col rounded-2xl border px-3 py-1.5 text-left text-[13px] leading-snug md:max-w-[65%]",
    mine ? "self-end" : "self-start",
  );
  if (quote.unavailable) return <div className={cn(cls, "text-muted-foreground italic")}>Original message unavailable</div>;
  return (
    <button type="button" className={cn(cls, "press-tint")} onClick={() => onJump(quote.id)} aria-label="Go to the original message">
      <span className="text-[11px] font-medium text-muted-foreground">{quote.from === "luke" ? "You" : "Claude"}</span>
      <span className="line-clamp-2 text-muted-foreground">{quote.snippet}</span>
    </button>
  );
}

/** Web addresses in a message become tappable links. */
function Linkified({ text, mine }: { text: string; mine: boolean }) {
  const parts = text.split(/(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={cn("underline", mine ? "text-primary-foreground" : "text-doing")}>
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

const linkIcons = { task: CheckSquare, note: NotebookPen, document: FileText, artifact: Sparkles, project: Folder, routine: Repeat, entry: Archive, inspiration: Lightbulb };
const linkKinds = { task: "Task", note: "Note", document: "Document", artifact: "Artifact", project: "Project", routine: "Routine", entry: "Work archive", inspiration: "Inspiration" };

/** A card under a message for the task, artifact or other thing it's about. */
function LinkCard({ link, mine }: { link: NonNullable<ThreadMessage["link"]>; mine: boolean }) {
  const { openTask } = useTaskEditor();
  const Icon = linkIcons[link.type] ?? Bot;
  const gone = !link.title;
  const body = (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex min-w-0 flex-col text-left">
        <span className="text-[11px] text-muted-foreground">{linkKinds[link.type]}</span>
        <span className="truncate text-[14px] font-medium">{gone ? "No longer here" : link.title}</span>
      </span>
    </>
  );
  const cls = cn(
    "press-tint mt-1 flex max-w-[80%] items-center gap-2.5 rounded-2xl border bg-card px-3 py-2 md:max-w-[70%]",
    mine ? "self-end" : "self-start",
  );
  if (gone) return <div className={cn(cls, "opacity-60")}>{body}</div>;
  if (link.type === "task")
    return (
      <button
        type="button"
        className={cls}
        onClick={async () => {
          try {
            openTask(await op("get_task", { id: link.id }));
          } catch {
            alert("That task isn't there any more.");
          }
        }}
      >
        {body}
      </button>
    );
  const href =
    link.type === "routine"
      ? `/agents/routines/${link.id}`
      : link.type === "entry"
        ? `/archive/${link.id}`
        : link.type === "inspiration"
          ? `/inspiration?item=${link.id}`
          : `/${link.type}s/${link.id}`;
  return (
    <Link href={href} className={cls}>
      {body}
    </Link>
  );
}
