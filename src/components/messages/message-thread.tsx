"use client";

import { Archive, ArrowUp, Lightbulb, Bot, CheckSquare, FileText, Folder, Plus, Repeat, Sparkles, Newspaper } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
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
};

/** Messages more than this far apart get their own time line, like iMessage. */
const GAP_MS = 60 * 60_000;

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
  const shown = [...messages, ...sending.filter((s) => !messages.some((m) => m.id === s.id))];

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
  const lastLuke = shown.findLastIndex((m) => m.from === "luke");
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
        <ol className="mx-auto flex w-full max-w-2xl flex-col gap-1 pb-2" aria-label="Messages">
          {shown.map((m, i) => {
            const prev = shown[i - 1];
            const at = new Date(m.createdAt);
            const newTime = !prev || at.getTime() - new Date(prev.createdAt).getTime() > GAP_MS;
            const sameSender = prev && !newTime && prev.from === m.from;
            const mine = m.from === "luke";
            const pending = m.id.startsWith("sending-");
            return (
              <Fragment key={m.id}>
                {newTime && (
                  <li className="pt-4 pb-1.5 text-center text-[12px] text-muted-foreground" aria-hidden>
                    <span className="font-medium">{friendlyDay(todayIn(timeZone, at), today)}</span> {time(at)}
                  </li>
                )}
                <li className={cn("flex flex-col", mine ? "items-end" : "items-start", !sameSender && !newTime && "mt-2")}>
                  {!mine && m.routine && (!sameSender || prev.routine !== m.routine) && (
                    <span className="px-3 pb-0.5 text-[11px] text-muted-foreground">{m.routine}</span>
                  )}
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
                </li>
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
      <Composer
        onSending={(m) => setSending((s) => [...s, m])}
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
  onSending,
  onSent,
}: {
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
    });
    setText("");
    setPicked([]);
    startTransition(async () => {
      try {
        const sent = await op("send_message", {
          ...(clean && { text: clean }),
          ...(files.length && {
            attachments: files.map((f) => ({ fileId: f.fileId, thumbId: f.thumbId, name: f.name, width: f.width, height: f.height })),
          }),
        });
        onSent(tempId, { ...sent, routine: null, createdAt: new Date(sent.createdAt).toISOString() });
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
      <PendingTray items={picked} onRemove={remove} />
      <div className="mx-auto flex max-w-2xl items-end gap-2">
        <button
          type="button"
          onClick={() => filePicker.current?.click()}
          aria-label="Add photos or files"
          className="mb-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
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
            const files = [...e.clipboardData.files];
            if (!files.length) return;
            e.preventDefault();
            add(files);
          }}
          onKeyDown={(e) => {
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
          disabled={!canSend}
          aria-label="Send"
          className="mb-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
        >
          <ArrowUp className="size-[18px]" strokeWidth={2.5} aria-hidden />
        </button>
      </div>
    </form>
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

const linkIcons = { task: CheckSquare, note: FileText, document: Newspaper, artifact: Sparkles, project: Folder, routine: Repeat, entry: Archive, inspiration: Lightbulb };
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
