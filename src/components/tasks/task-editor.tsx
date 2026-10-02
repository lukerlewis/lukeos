"use client";

import { ChevronDown, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useRef, useState } from "react";
import { Comments } from "@/components/comments/comments";
import type { Comment } from "@/core/comments";
import type { Project } from "@/core/projects";
import type { Task } from "@/core/tasks";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { bucketForDate } from "@/lib/board";
import { addDays, endOfWeek } from "@/lib/dates";
import { showTrashedToast } from "@/components/shell/toast";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import {
  bucketLabel,
  buckets,
  effortLabel,
  efforts,
  priorities,
  priorityLabel,
  repeatLabel,
  repeats,
  statuses,
  statusLabel,
  type Bucket,
  type Effort,
  type Priority,
  type Repeat,
  type Status,
} from "@/lib/task-fields";
import { MadeByLabel } from "./made-by";
import { HighlightedText, SmartChips, useSmartEntry } from "./smart-chips";

type Draft = {
  id?: string;
  title: string;
  projectId: string | null;
  status: Status;
  bucket: Bucket;
  dueDate: string | null;
  priority: Priority | null;
  effort: Effort | null;
  repeat: Repeat | null;
  notes: string;
  madeBy?: Task["madeBy"];
  createdAt?: Task["createdAt"];
};

type Editor = {
  /** Open an existing task to view and change it. */
  openTask: (task: Task) => void;
  /** Start a new task, optionally in a project or list. */
  newTask: (defaults?: Partial<Pick<Draft, "title" | "projectId" | "bucket" | "status">>) => void;
};

const EditorContext = createContext<Editor | null>(null);

export function useTaskEditor() {
  const editor = use(EditorContext);
  if (!editor) throw new Error("useTaskEditor must be used inside <TaskEditorProvider>");
  return editor;
}

/** Holds the one task editor the whole app shares, so any screen can open it. */
export function TaskEditorProvider({
  projects,
  today,
  timeZone,
  children,
}: {
  projects: Project[];
  today: string;
  timeZone: string;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);

  const openTask = useCallback((t: Task) => {
    setDraft({
      id: t.id,
      title: t.title,
      projectId: t.project?.id ?? null,
      status: t.status,
      bucket: t.bucket,
      dueDate: t.dueDate,
      priority: t.priority,
      effort: t.effort,
      repeat: t.repeat,
      notes: t.notes ?? "",
      madeBy: t.madeBy,
      createdAt: t.createdAt,
    });
  }, []);

  // A link like /?task=<id> (from a notification) opens that task.
  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("task");
    if (!id) return;
    url.searchParams.delete("task");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    op("get_task", { id })
      .then(openTask)
      .catch(() => {});
  }, [openTask]);

  const newTask = useCallback<Editor["newTask"]>((defaults) => {
    // A new task goes in Today unless the screen picked a list.
    setDraft({
      title: defaults?.title ?? "",
      projectId: defaults?.projectId ?? null,
      status: defaults?.status ?? "todo",
      bucket: defaults?.bucket ?? "today",
      dueDate: null,
      priority: null,
      effort: null,
      repeat: null,
      notes: "",
    });
  }, []);

  return (
    <EditorContext value={{ openTask, newTask }}>
      {children}
      {draft && (
        <TaskDialog
          key={draft.id ?? "new"}
          initial={draft}
          projects={projects}
          today={today}
          timeZone={timeZone}
          onClose={() => setDraft(null)}
        />
      )}
    </EditorContext>
  );
}

function TaskDialog({
  initial,
  projects,
  today,
  timeZone,
  onClose,
}: {
  initial: Draft;
  projects: Project[];
  today: string;
  timeZone: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Adding a task on a phone shows just the name; the rest is behind "Show more".
  const [more, setMore] = useState(!!initial.id);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const isNew = !initial.id;
  // A new task's name is read for dates and repeats ("laundry tomorrow"); picking a day by hand wins over it.
  const smart = useSmartEntry(draft.title, today, isNew);
  const [dueTouched, setDueTouched] = useState(false);
  const { parsed } = smart;
  const dueDate = dueTouched ? draft.dueDate : (parsed.dueDate ?? (parsed.repeat ? (draft.dueDate ?? today) : draft.dueDate));
  const repeat = parsed.repeat ?? draft.repeat;
  // A new task's list follows its due date until a list is picked by hand.
  const [bucketTouched, setBucketTouched] = useState(false);
  const bucket = isNew && !bucketTouched && dueDate ? bucketForDate(dueDate, today) : draft.bucket;
  const highlight = isNew && parsed.matches.length > 0;

  function pickDue(value: string | null) {
    if (parsed.matches.some((m) => m.kind === "date")) smart.dismiss("date");
    setDueTouched(true);
    set("dueDate", value);
  }

  function pickRepeat(value: Repeat | null) {
    smart.dismiss("repeat");
    set("repeat", value);
  }

  useEffect(() => {
    if (isNew) titleRef.current?.focus();
  }, [isNew]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!parsed.title) {
      setError("Give the task a name.");
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const fields = {
      title: parsed.title,
      projectId: draft.projectId,
      status: draft.status,
      bucket,
      dueDate,
      priority: draft.priority,
      effort: draft.effort,
      repeat,
      notes: draft.notes.trim() || null,
    };
    try {
      if (draft.id) await op("update_task", { id: draft.id, ...fields });
      else await op("create_task", fields);
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft.id) return;
    setBusy(true);
    try {
      await op("delete_task", { id: draft.id });
      showTrashedToast("task", draft.id);
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const dueChoices = [
    { label: "Today", value: today },
    { label: "Tomorrow", value: addDays(today, 1) },
    { label: "This weekend", value: endOfWeek(today) === today ? today : addDays(endOfWeek(today), -1) },
    { label: "Next week", value: addDays(endOfWeek(today), 1) },
  ];

  return (
    <Dialog label={isNew ? "New task" : "Task"} onClose={onClose} focusFirstField={isNew}>
      <form onSubmit={save} className="flex flex-col">
        <div className="flex items-start gap-2 px-5 pt-4">
          <div className="grid min-w-0 grow">
            {highlight && (
              <div
                aria-hidden
                className="pointer-events-none col-start-1 row-start-1 py-1 text-lg font-semibold break-words whitespace-pre-wrap"
              >
                <HighlightedText text={draft.title} matches={parsed.matches} />
              </div>
            )}
            <textarea
              ref={titleRef}
              value={draft.title}
              onChange={(e) => set("title", e.target.value.replace(/\n/g, " "))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
              }}
              placeholder="What needs doing?"
              aria-label="Task name"
              rows={1}
              className={cn(
                "col-start-1 row-start-1 field-sizing-content min-h-9 resize-none bg-transparent py-1 text-lg font-semibold break-words outline-none placeholder:text-muted-foreground",
                highlight && "text-transparent caret-foreground",
              )}
            />
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="-mr-2 shrink-0">
            <X className="size-5" aria-hidden />
          </Button>
        </div>

        <SmartChips
          parsed={parsed}
          dueDate={dueDate}
          repeat={repeat}
          today={today}
          onDismiss={smart.dismiss}
          className="mx-5 mt-2"
        />

        {!more && (
          <button
            type="button"
            onClick={() => setMore(true)}
            className="mx-5 mt-3 flex items-center gap-1 self-start text-[13px] font-medium text-muted-foreground md:hidden"
          >
            Show more
            <ChevronDown className="size-4" aria-hidden />
          </button>
        )}

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className={cn("flex-col gap-4", more ? "flex" : "hidden md:flex")}>
            <Field label="Status">
              <Segmented
                value={draft.status}
                onChange={(v) => set("status", v)}
                options={statuses.map((s) => ({ value: s, label: statusLabel[s] }))}
              />
            </Field>

            <Field label="List">
              <Segmented
                value={bucket}
                onChange={(v) => {
                  setBucketTouched(true);
                  set("bucket", v);
                }}
                options={buckets.map((b) => ({ value: b, label: bucketLabel[b] }))}
              />
            </Field>

            <Field label="Due">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={dueDate ?? ""}
                  onChange={(e) => pickDue(e.target.value || null)}
                  aria-label="Due date"
                  className="h-9 rounded-lg border bg-card px-2.5 text-[16px] md:text-[13px] shadow-xs"
                />
                {dueChoices.map((c) => (
                  <Chip key={c.label} active={dueDate === c.value} onClick={() => pickDue(c.value)}>
                    {c.label}
                  </Chip>
                ))}
                {dueDate && <Chip onClick={() => pickDue(null)}>No date</Chip>}
              </div>
            </Field>

            <Field label="Repeat">
              <select
                value={repeat ?? ""}
                onChange={(e) => pickRepeat((e.target.value || null) as Repeat | null)}
                aria-label="Repeat"
                className="h-9 w-full rounded-lg border bg-card px-2.5 text-[16px] md:text-[13px] shadow-xs sm:w-auto sm:min-w-56"
              >
                <option value="">Never</option>
                {repeats.map((r) => (
                  <option key={r} value={r}>
                    {repeatLabel[r]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Priority">
              <Segmented
                value={draft.priority ?? "none"}
                onChange={(v) => set("priority", v === "none" ? null : v)}
                options={[{ value: "none" as const, label: "None" }, ...priorities.map((p) => ({ value: p, label: priorityLabel[p] }))]}
              />
            </Field>

            <Field label="Effort">
              <Segmented
                value={draft.effort ?? "none"}
                onChange={(v) => set("effort", v === "none" ? null : v)}
                options={[{ value: "none" as const, label: "None" }, ...efforts.map((x) => ({ value: x, label: effortLabel[x] }))]}
              />
            </Field>

            <Field label="Project">
              <select
                value={draft.projectId ?? ""}
                onChange={(e) => set("projectId", e.target.value || null)}
                aria-label="Project"
                className="h-9 w-full rounded-lg border bg-card px-2.5 text-[16px] md:text-[13px] shadow-xs sm:w-auto sm:min-w-56"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Notes">
              <textarea
                value={draft.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Add details, links or a checklist…"
                aria-label="Notes"
                rows={4}
                className="field-sizing-content min-h-24 w-full resize-none rounded-lg border bg-card px-3 py-2 text-[16px] md:text-[14px] shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring"
              />
            </Field>

            {draft.id && <TaskComments taskId={draft.id} timeZone={timeZone} />}

            {draft.madeBy && draft.createdAt && (
              <p className="text-xs text-muted-foreground">
                <MadeByLabel madeBy={draft.madeBy} createdAt={draft.createdAt} />
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          {!isNew && (
            <Button variant="danger" onClick={remove} disabled={busy} className="-ml-2">
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
          )}
          <div className="grow" />
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : isNew ? "Add task" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The task's comments: Luke asks Claude something here (or with @claude), and Claude answers in the same place. */
function TaskComments({ taskId, timeZone }: { taskId: string; timeZone: string }) {
  const [threads, setThreads] = useState<Comment[] | null>(null);
  const load = useCallback(() => {
    op("list_comments", { targetType: "task", targetId: taskId })
      .then(setThreads)
      .catch(() => {});
  }, [taskId]);

  useEffect(() => {
    load();
    // A notification while the task is open (e.g. Claude replying) shows straight away.
    const onPush = (e: MessageEvent) => e.data?.type === "lukeos:push" && load();
    navigator.serviceWorker?.addEventListener("message", onPush);
    return () => navigator.serviceWorker?.removeEventListener("message", onPush);
  }, [load]);

  if (!threads) return null;
  return <Comments target={{ type: "task", id: taskId }} threads={threads} timeZone={timeZone} onChanged={load} />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="min-w-0 grow">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="h-8 rounded-full border px-3 text-[13px] font-medium text-subtle-foreground hover:bg-muted aria-pressed:border-foreground aria-pressed:text-foreground"
    >
      {children}
    </button>
  );
}
