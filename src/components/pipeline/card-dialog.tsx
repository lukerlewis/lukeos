"use client";

import { Archive, Check, CheckSquare, FileText, Lightbulb, NotebookPen, Paperclip, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Comments } from "@/components/comments/comments";
import { showToast, showTrashedToast } from "@/components/shell/toast";
import { MadeByLabel } from "@/components/tasks/made-by";
import { StatusIcon } from "@/components/tasks/status-circle";
import { useTaskEditor } from "@/components/tasks/task-editor";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { Comment } from "@/core/comments";
import type { AttachableType, Card, PipelineColumn } from "@/core/pipeline";
import { friendlyDay } from "@/lib/dates";
import { isInbox } from "@/lib/inbox";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";

/** An existing card to open, or where a new one goes. */
export type CardDraft = { id?: string; projectId?: string; columnId?: string };

const field =
  "w-full rounded-lg border bg-card px-3 py-2 text-body border-stroke-strong outline-none placeholder:text-muted-foreground focus-visible:border-ring md:text-preview";

/** A pipeline card: its name, column and notes, the tasks inside it, what's attached, and comments. */
export function CardDialog({
  initial,
  columns,
  timeZone,
  today,
  onClose,
}: {
  initial: CardDraft;
  columns: PipelineColumn[];
  timeZone: string;
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const isNew = !initial.id;
  const [card, setCard] = useState<Card | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [columnId, setColumnId] = useState(initial.id ? "" : (initial.columnId ?? columns[0]?.id ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  /** Reads the card; the first time, also fills in the fields Luke edits. */
  const load = useCallback(
    (fill = false) => {
      if (!initial.id) return;
      op("get_card", { id: initial.id })
        .then((next) => {
          setCard(next);
          if (!fill) return;
          setTitle(next.title);
          setNotes(next.notes ?? "");
          setColumnId(next.columnId ?? "");
        })
        .catch((err: Error) => setError(err.message));
    },
    [initial.id],
  );

  useEffect(() => load(true), [load]);

  /** Reloads the card and the board behind it after a change inside the card. */
  const changed = useCallback(() => {
    load();
    router.refresh();
  }, [load, router]);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    const name = title.trim();
    if (!name) {
      setError("Give the card a name.");
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (card) {
        await op("update_card", {
          id: card.id,
          title: name,
          notes: notes.trim() || null,
          ...(columnId && columnId !== card.columnId && { column: columnId }),
        });
      } else if (initial.projectId) {
        await op("create_card", { projectId: initial.projectId, title: name, notes: notes.trim() || undefined, column: columnId || undefined });
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!card) return;
    setBusy(true);
    try {
      await op("delete_card", { id: card.id });
      showTrashedToast("card", card.id);
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  /** Inbox: Approve moves the idea on to the next column; Reject hides it (Claude keeps it). */
  async function review(action: "approve" | "reject") {
    if (!card) return;
    setBusy(true);
    try {
      await op(action === "approve" ? "approve_card" : "reject_card", { id: card.id });
      if (action === "reject") {
        showToast("Idea rejected", async () => {
          await op("unreject_card", { id: card.id });
          router.refresh();
        });
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const loading = !isNew && !card;
  const inInbox = !!card && isInbox(card.column) && card.columnId === columnId;
  const canApprove = inInbox && columns.findIndex((c) => c.id === card.columnId) < columns.length - 1;

  return (
    <Dialog label={isNew ? "New card" : "Card"} onClose={onClose} focusFirstField={isNew}>
      <form onSubmit={save} className="flex flex-col">
        <div className="flex items-start gap-2 px-5 pt-4">
          <textarea
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              }
            }}
            placeholder={loading ? "" : "What's the idea?"}
            aria-label="Card name"
            rows={1}
            className="field-sizing-content min-h-9 min-w-0 grow resize-none bg-transparent py-1 text-lg font-medium break-words outline-none placeholder:text-muted-foreground"
          />
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="-mr-2 shrink-0">
            <X className="size-5" aria-hidden />
          </Button>
        </div>

        {inInbox && (
          <div className="flex gap-2 px-5 pt-3">
            <Button variant="outline" onClick={() => review("reject")} disabled={busy} className="grow">
              <X className="size-4" aria-hidden />
              Reject idea
            </Button>
            {canApprove && (
              <Button onClick={() => review("approve")} disabled={busy} className="grow">
                <Check className="size-4" aria-hidden />
                Approve idea
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-5 px-5 py-4">
          <Row label="Column">
            <select
              value={columnId}
              onChange={(e) => setColumnId(e.target.value)}
              aria-label="Column"
              disabled={loading}
              className="h-9 w-full rounded-lg border bg-card px-2.5 text-body border-stroke-strong sm:w-auto sm:min-w-56 md:text-meta"
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Angle, hook, links…"
              aria-label="Notes"
              rows={3}
              disabled={loading}
              className={cn(field, "field-sizing-content min-h-20 resize-none")}
            />
          </Row>

          {card && (
            <>
              <CardTasks card={card} today={today} onChanged={changed} />
              <CardAttachments card={card} onChanged={changed} />
              <CardComments cardId={card.id} timeZone={timeZone} />
              <p className="text-meta text-muted-foreground">
                <MadeByLabel madeBy={card.madeBy} createdAt={card.createdAt} />
              </p>
            </>
          )}

          {error && (
            <p role="alert" className="text-meta text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center gap-2 border-t bg-card px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          {card && (
            <Button variant="danger" onClick={remove} disabled={busy} className="-ml-2">
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
          )}
          <div className="grow" />
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || loading}>
            {busy ? "Saving…" : isNew ? "Add card" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
      <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground sm:pt-2.5">{label}</span>
      <div className="min-w-0 grow">{children}</div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="grow text-xs font-medium text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The tasks inside the card. They're normal tasks, so they show in Luke's lists too. */
function CardTasks({ card, today, onChanged }: { card: Card; today: string; onChanged: () => void }) {
  const { openTask } = useTaskEditor();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(request: () => Promise<unknown>) {
    setBusy(true);
    try {
      await request();
      onChanged();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const title = text.trim();
    if (!title) return;
    setText("");
    await act(() => op("create_task", { title, cardId: card.id }));
  }

  return (
    <Section title="Tasks">
      {card.tasks.length > 0 && (
        <ul className="flex flex-col rounded-lg border">
          {card.tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-1 border-b px-1.5 last:border-b-0">
              <button
                type="button"
                onClick={() => act(() => op("update_task", { id: t.id, status: t.status === "done" ? "todo" : "done" }))}
                aria-label={t.status === "done" ? `Mark "${t.title}" as not done` : `Mark "${t.title}" as done`}
                className="flex size-10 shrink-0 items-center justify-center"
                disabled={busy}
              >
                <StatusIcon status={t.status} className="size-[22px] md:size-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => openTask(t)}
                className={cn(
                  "min-w-0 grow py-2 text-left text-control break-words",
                  t.status === "done" && "text-muted-foreground line-through",
                )}
              >
                {t.title}
                {t.dueDate && t.status !== "done" && (
                  <span className="ml-2 text-meta text-muted-foreground">{friendlyDay(t.dueDate, today)}</span>
                )}
              </button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => act(() => op("detach_from_card", { cardId: card.id, type: "task", id: t.id }))}
                aria-label={`Take "${t.title}" out of this card`}
                title="Take out of this card"
                disabled={busy}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="Add a task"
          aria-label="Add a task to this card"
          className={cn(field, "h-9 py-0")}
        />
        <Button variant="outline" onClick={add} disabled={busy || !text.trim()}>
          Add
        </Button>
      </div>
    </Section>
  );
}

const kinds: { type: AttachableType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { type: "document", label: "Document", icon: FileText },
  { type: "note", label: "Note", icon: NotebookPen },
  { type: "task", label: "Task", icon: CheckSquare },
  { type: "inspiration", label: "Inspiration", icon: Lightbulb },
  { type: "entry", label: "Work archive", icon: Archive },
];
const iconOf = (type: AttachableType) => kinds.find((k) => k.type === type)!.icon;

/** Documents, notes, Inspiration items and Work archive entries on the card, and a picker to add more (tasks too). */
function CardAttachments({ card, onChanged }: { card: Card; onChanged: () => void }) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function act(request: () => Promise<unknown>) {
    setBusy(true);
    try {
      await request();
      onChanged();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Attached"
      action={
        !picking && (
          <Button variant="ghost" size="sm" onClick={() => setPicking(true)} className="-my-1 -mr-2">
            <Paperclip className="size-4" aria-hidden />
            Attach
          </Button>
        )
      }
    >
      {card.attachments.length > 0 && (
        <ul className="flex flex-col rounded-lg border">
          {card.attachments.map((a) => {
            const Icon = iconOf(a.type);
            return (
              <li key={`${a.type}-${a.id}`} className="flex items-center gap-2 border-b pl-3 last:border-b-0">
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <Link href={a.href} className="min-w-0 grow truncate py-2.5 text-control hover:underline">
                  {a.title}
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => act(() => op("detach_from_card", { cardId: card.id, type: a.type, id: a.id }))}
                  aria-label={`Take "${a.title}" off this card`}
                  title="Take off this card"
                  disabled={busy}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {card.attachments.length === 0 && !picking && <p className="text-meta text-muted-foreground">Nothing attached.</p>}
      {picking && (
        <Picker
          card={card}
          onPick={(type, id) => act(() => op("attach_to_card", { cardId: card.id, type, id }))}
          onDone={() => setPicking(false)}
        />
      )}
    </Section>
  );
}

type Found = { id: string; title: string; detail?: string };

/** Finds something to attach: the latest of a kind, or what matches the words typed. */
function Picker({ card, onPick, onDone }: { card: Card; onPick: (type: AttachableType, id: string) => Promise<void>; onDone: () => void }) {
  const [type, setType] = useState<AttachableType>("document");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);

  useEffect(() => {
    let stale = false;
    const words = query.trim();
    const timer = setTimeout(async () => {
      try {
        let rows: Found[];
        if (type === "task") {
          rows = words
            ? (await op("search", { query: words, type: "task", limit: 15 })).map((r) => ({ id: r.id, title: r.title }))
            : (await op("list_tasks", { projectId: card.project.id, limit: 15 })).map((t) => ({ id: t.id, title: t.title }));
        } else if (type === "document") {
          rows = (await op("list_documents", { search: words || undefined, limit: 15 })).map((d) => ({ id: d.id, title: d.title || "Untitled" }));
        } else if (type === "note") {
          rows = (await op("list_notes", { search: words || undefined, limit: 15 })).map((n) => ({ id: n.id, title: n.title || "Untitled" }));
        } else if (type === "entry") {
          rows = (await op("list_archive", { search: words || undefined, limit: 15 })).map((e) => ({ id: e.id, title: e.title || "Untitled" }));
        } else {
          rows = (await op("list_inspiration", { search: words || undefined, limit: 15 })).map((i) => ({
            id: i.id,
            title: i.title || i.body.slice(0, 60) || i.site || "Picture",
          }));
        }
        const taken = new Set(type === "task" ? card.tasks.map((t) => t.id) : card.attachments.filter((a) => a.type === type).map((a) => a.id));
        if (!stale) setFound(rows.filter((r) => !taken.has(r.id)));
      } catch {
        if (!stale) setFound([]);
      }
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [type, query, card]);

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-2.5">
      <div className="flex flex-wrap gap-1.5">
        {kinds.map((k) => (
          <button
            key={k.type}
            type="button"
            onClick={() => {
              setType(k.type);
              setFound(null);
            }}
            aria-pressed={type === k.type}
            className="h-9 rounded-lg border border-stroke px-3 text-preview font-medium text-subtle-foreground hover:bg-muted aria-pressed:border-transparent aria-pressed:bg-selected aria-pressed:text-ink"
          >
            {k.label}
          </button>
        ))}
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        placeholder="Search"
        aria-label="Search for something to attach"
        className={cn(field, "h-9 py-0")}
      />
      <ul className="flex max-h-56 flex-col overflow-y-auto">
        {found === null ? (
          <li className="px-2 py-3 text-meta text-muted-foreground">Looking…</li>
        ) : found.length === 0 ? (
          <li className="px-2 py-3 text-meta text-muted-foreground">Nothing found.</li>
        ) : (
          found.map((r) => {
            const Icon = iconOf(type);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={async () => {
                    await onPick(type, r.id);
                    onDone();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-control hover:bg-muted"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 truncate">{r.title}</span>
                  <Plus className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            );
          })
        )}
      </ul>
      <Button variant="ghost" size="sm" onClick={onDone} className="self-end">
        Done
      </Button>
    </div>
  );
}

/** The card's comments: Luke asks Claude something here (or with @claude), and Claude answers in the same place. */
function CardComments({ cardId, timeZone }: { cardId: string; timeZone: string }) {
  const [threads, setThreads] = useState<Comment[] | null>(null);
  const load = useCallback(() => {
    op("list_comments", { targetType: "card", targetId: cardId })
      .then(setThreads)
      .catch(() => {});
  }, [cardId]);

  useEffect(() => {
    load();
    const onPush = (e: MessageEvent) => e.data?.type === "lukeos:push" && load();
    navigator.serviceWorker?.addEventListener("message", onPush);
    return () => navigator.serviceWorker?.removeEventListener("message", onPush);
  }, [load]);

  if (!threads) return null;
  return <Comments target={{ type: "card", id: cardId }} threads={threads} timeZone={timeZone} onChanged={load} />;
}
