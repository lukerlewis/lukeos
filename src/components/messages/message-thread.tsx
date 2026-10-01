"use client";

import { ArrowUp, Bot, CheckSquare, FileText, Folder, Repeat, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { useTaskEditor } from "@/components/tasks/task-editor";
import { friendlyDay, todayIn } from "@/lib/dates";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import { MESSAGES_READ_EVENT } from "./unread";

export type ThreadMessage = {
  id: string;
  text: string;
  from: "luke" | "claude";
  /** "End of day recap", when a routine sent it. */
  routine: string | null;
  link: { type: "task" | "note" | "artifact" | "project" | "routine"; id: string; title: string } | null;
  createdAt: string;
  answered: boolean;
};

/** Messages more than this far apart get their own time line, like iMessage. */
const GAP_MS = 60 * 60_000;

/**
 * The Messages chain: Luke's texts on the right in blue, Claude's on the
 * left in grey, with a box at the bottom to write a new one.
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
  const endRef = useRef<HTMLDivElement>(null);
  const [sending, setSending] = useState<ThreadMessage[]>([]);
  const shown = [...messages, ...sending.filter((s) => !messages.some((m) => m.id === s.id))];

  // Opening Messages marks Claude's texts as seen and clears the app icon's number.
  useEffect(() => {
    if ("clearAppBadge" in navigator) navigator.clearAppBadge().catch(() => {});
    if (unread === 0) return;
    op("mark_messages_read", {})
      .then(() => window.dispatchEvent(new Event(MESSAGES_READ_EVENT)))
      .catch(() => {});
  }, [unread]);

  // Start at the newest message, and follow new ones as they arrive.
  useLayoutEffect(() => {
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
    <div className="flex grow flex-col">
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
      <div ref={endRef} />
      <Composer
        onSending={(m) => setSending((s) => [...s, m])}
        onSent={(tempId, real) =>
          setSending((s) => (real ? s.map((x) => (x.id === tempId ? real : x)) : s.filter((x) => x.id !== tempId)))
        }
      />
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
  const [, startTransition] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);

  // The box grows with what's typed, up to a few lines.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  function send() {
    const clean = text.trim();
    if (!clean) return;
    const tempId = `sending-${Date.now()}`;
    onSending({ id: tempId, text: clean, from: "luke", routine: null, link: null, createdAt: new Date().toISOString(), answered: false });
    setText("");
    startTransition(async () => {
      try {
        const sent = await op("send_message", { text: clean });
        onSent(tempId, { ...sent, routine: null, createdAt: new Date(sent.createdAt).toISOString() });
        router.refresh();
      } catch (err) {
        onSent(tempId, null);
        setText(clean);
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
      className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-[5] -mx-5 mt-auto border-t bg-background/95 px-3 py-2 backdrop-blur md:bottom-0 md:mx-0 md:border-0 md:px-0 md:pb-6"
    >
      <div className="mx-auto flex max-w-2xl items-end gap-2">
        <textarea
          ref={box}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
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
          disabled={!text.trim()}
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

const linkIcons = { task: CheckSquare, note: FileText, artifact: Sparkles, project: Folder, routine: Repeat };
const linkKinds = { task: "Task", note: "Note", artifact: "Artifact", project: "Project", routine: "Routine" };

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
  const href = link.type === "routine" ? `/agents/routines/${link.id}` : `/${link.type}s/${link.id}`;
  return (
    <Link href={href} className={cls}>
      {body}
    </Link>
  );
}
