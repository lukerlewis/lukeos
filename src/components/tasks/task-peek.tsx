"use client";

import {
  Briefcase,
  Calendar,
  ChevronDown,
  ChevronsRight,
  CircleDot,
  Flame,
  Folder,
  Layers,
  List,
  Maximize2,
  Minimize2,
  Repeat as RepeatIcon,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Comments } from "@/components/comments/comments";
import { showToast } from "@/components/shell/toast";
import { trashInBackground } from "@/lib/background";
import { friendlyDay } from "@/lib/dates";
import { showTask } from "@/lib/live-tasks";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import {
  areaLabel,
  areas,
  bucketLabel,
  buckets,
  effortLabel,
  efforts,
  isProjectArea,
  laneLabel,
  lanes,
  priorities,
  priorityLabel,
  repeatName,
  statuses,
  statusLabel,
  timeOfDayLabel,
  timesOfDay,
  type Repeat,
} from "@/lib/task-fields";
import type { Comment } from "@/core/comments";
import type { Project } from "@/core/projects";
import { MadeByLabel } from "./made-by";
import { StatusIcon } from "./status-circle";
import { asTask, repeatChoices, type Draft, type DraftFields } from "./task-draft";
import { TaskNotes } from "./task-notes";

/**
 * An open task, like a Notion side peek: a panel over the right half of the
 * screen on computers (the list stays in view beside it, and it can widen to
 * the whole screen), and the whole screen on phones. Changes save themselves.
 */
export function TaskPeek({
  initial,
  projects,
  today,
  timeZone,
  onClose,
}: {
  initial: Draft & { id: string };
  projects: Project[];
  today: string;
  timeZone: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  // Phones show the main details; the rest are behind "more".
  const [more, setMore] = useState(false);
  const closed = useRef(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const fields: DraftFields = {
    title: draft.title.trim(),
    projectId: draft.projectId,
    status: draft.status,
    bucket: draft.bucket,
    dueDate: draft.dueDate,
    priority: draft.priority,
    effort: draft.effort,
    area: draft.area,
    timeOfDay: draft.timeOfDay,
    lane: draft.lane,
    repeat: draft.repeat,
    notes: draft.notes.trim() || null,
  };

  // Each change saves itself a moment later; there's no Save button.
  const fieldsKey = JSON.stringify(fields);
  const savedKey = useRef(fieldsKey);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const changed = useRef(false);

  const flush = useCallback(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    const key = fieldsKey;
    if (key === savedKey.current) return saving.current;
    savedKey.current = key;
    changed.current = true;
    const { title, ...rest } = JSON.parse(key) as DraftFields;
    // Lists show the change at once, before it's saved.
    if (initial.base) showTask(asTask(JSON.parse(key), projects, initial.base));
    // A cleared name isn't saved; the rest still is.
    const update = title ? { id: initial.id, title, ...rest } : { id: initial.id, ...rest };
    saving.current = saving.current
      .then(() => op("update_task", update))
      .then(
        () => setError(null),
        (err) => (closed.current ? showToast(`Couldn't save the task. ${(err as Error).message}`) : setError((err as Error).message)),
      );
    return saving.current;
  }, [initial.id, initial.base, fieldsKey, projects]);

  useEffect(() => {
    if (fieldsKey === savedKey.current) return;
    pending.current = setTimeout(flush, 600);
    return () => {
      if (pending.current) clearTimeout(pending.current);
    };
  }, [fieldsKey, flush]);

  // Opening another task while this one is open swaps it in; its last change still saves.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(
    () => () => {
      if (!closed.current) void flushRef.current().then(() => changed.current && router.refresh());
    },
    [router],
  );

  // Closing doesn't wait: the last change finishes saving behind the scenes.
  const close = useCallback(() => {
    closed.current = true;
    void flush().then(() => changed.current && router.refresh());
    onClose();
  }, [flush, onClose, router]);

  // Escape closes it, unless something on top of it (a menu, a box) is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  function remove() {
    if (pending.current) clearTimeout(pending.current);
    closed.current = true;
    const id = initial.id;
    // Any change still waiting is saved first, so Undo brings back the latest version.
    trashInBackground("task", id, () => saving.current.then(() => op("delete_task", { id })), { then: () => router.refresh() });
    onClose();
  }

  const projectArea = isProjectArea(draft.area);
  // On phones these sit behind "more" until it's tapped.
  const extra = [
    true, // Area
    draft.area === "life" || draft.area === "work", // Time or Card
    true, // Repeat
    projectArea || !!draft.effort, // Focus
    projectArea || !!draft.projectId, // Project
  ].filter(Boolean).length;
  const hide = more ? "" : "hidden md:flex";

  return (
    <aside
      role="dialog"
      aria-label="Task"
      className={cn(
        "motion-peek fixed inset-0 z-30 flex flex-col bg-background text-foreground",
        "md:left-auto md:w-1/2 md:min-w-[30rem] md:border-l md:border-stroke",
        full && "md:w-full md:min-w-0 md:border-l-0",
      )}
    >
      <div className="flex shrink-0 items-center gap-0.5 px-2 pt-[env(safe-area-inset-top)] md:px-3">
        <div className="flex h-14 items-center gap-0.5">
          <button type="button" onClick={close} aria-label="Close" title="Close" className={iconButton}>
            <ChevronDown className="size-[22px] md:hidden" aria-hidden />
            <ChevronsRight className="hidden size-[18px] md:block" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setFull((f) => !f)}
            aria-label={full ? "Back to side panel" : "Open as full page"}
            title={full ? "Back to side panel" : "Open as full page"}
            className={cn(iconButton, "hidden md:flex")}
          >
            {full ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
          </button>
        </div>
        <span className="grow" />
        {error && (
          <p role="alert" className="truncate px-2 text-meta text-danger">
            Not saved: {error}
          </p>
        )}
        <button type="button" onClick={remove} aria-label="Delete task" title="Delete task" className={cn(iconButton, "hover:text-danger")}>
          <Trash2 className="size-[18px]" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 grow overflow-y-auto overscroll-contain">
        <div className={cn("mx-auto flex w-full flex-col px-5 pt-1 pb-[max(env(safe-area-inset-bottom),4rem)] md:px-12 md:pt-4", full ? "max-w-3xl" : "max-w-2xl")}>
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => set("status", draft.status === "done" ? "todo" : "done")}
              aria-label={draft.status === "done" ? "Mark as to do" : "Mark as done"}
              title={draft.status === "done" ? "Mark as to do" : "Mark as done"}
              className="-m-2 mt-[-0.3rem] flex size-11 shrink-0 items-center justify-center rounded-lg"
            >
              <StatusIcon status={draft.status} className="size-7" />
            </button>
            <textarea
              value={draft.title}
              onChange={(e) => set("title", e.target.value.replace(/\n/g, " "))}
              onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              placeholder="Untitled"
              aria-label="Task name"
              rows={1}
              className="field-sizing-content min-w-0 grow resize-none bg-transparent text-section leading-tight font-medium break-words text-ink outline-none placeholder:text-muted-foreground md:text-title"
            />
          </div>

          <div className="mt-5 flex flex-col">
            <Prop icon={CircleDot} label="Status">
              <PropSelect
                label="Status"
                value={draft.status}
                onChange={(v) => set("status", v)}
                options={statuses.map((s) => ({ value: s, label: statusLabel[s] }))}
              />
            </Prop>
            <Prop icon={List} label="List">
              <PropSelect
                label="List"
                value={draft.bucket}
                onChange={(v) => set("bucket", v)}
                options={buckets.map((b) => ({ value: b, label: bucketLabel[b] }))}
              />
            </Prop>
            <Prop icon={Calendar} label="Due">
              <DuePicker value={draft.dueDate} today={today} onChange={(v) => set("dueDate", v)} />
            </Prop>
            <Prop icon={Flame} label="Priority">
              <PropSelect
                label="Priority"
                value={draft.priority ?? ""}
                onChange={(v) => set("priority", v || null)}
                options={[{ value: "" as const, label: "None" }, ...priorities.map((p) => ({ value: p, label: priorityLabel[p] }))]}
              />
            </Prop>

            <Prop icon={Briefcase} label="Area" className={hide}>
              <PropSelect
                label="Area"
                value={draft.area}
                onChange={(v) => {
                  // A project belongs to one area, so moving the task to another takes it out.
                  if (draft.projectId && projects.find((p) => p.id === draft.projectId)?.area !== v) set("projectId", null);
                  set("area", v);
                }}
                options={areas.map((a) => ({ value: a, label: areaLabel[a] }))}
              />
            </Prop>
            {/* Life's Today is split into Morning, Day and Evening; Work's into Signal and Noise. */}
            {draft.area === "life" && (
              <Prop icon={Layers} label="Time" className={hide}>
                <PropSelect
                  label="Time"
                  value={draft.timeOfDay}
                  onChange={(v) => set("timeOfDay", v)}
                  options={timesOfDay.map((x) => ({ value: x, label: timeOfDayLabel[x] }))}
                />
              </Prop>
            )}
            {draft.area === "work" && (
              <Prop icon={Layers} label="Card" className={hide}>
                <PropSelect
                  label="Card"
                  value={draft.lane}
                  onChange={(v) => set("lane", v)}
                  options={lanes.map((x) => ({ value: x, label: laneLabel[x] }))}
                />
              </Prop>
            )}
            <Prop icon={RepeatIcon} label="Repeat" className={hide}>
              <PropSelect
                label="Repeat"
                value={draft.repeat ?? ""}
                onChange={(v) => set("repeat", (v || null) as Repeat | null)}
                options={[{ value: "", label: "Never" }, ...repeatChoices(draft.repeat).map((r) => ({ value: r, label: repeatName(r) }))]}
              />
            </Prop>
            {/* Focus type is for Aya and Work; one already set still shows, so it can be cleared. */}
            {(projectArea || draft.effort) && (
              <Prop icon={Target} label="Focus" className={hide}>
                <PropSelect
                  label="Focus"
                  value={draft.effort ?? ""}
                  onChange={(v) => set("effort", v || null)}
                  options={[{ value: "" as const, label: "None" }, ...efforts.map((x) => ({ value: x, label: effortLabel[x] }))]}
                />
              </Prop>
            )}
            {(projectArea || draft.projectId) && (
              <Prop icon={Folder} label="Project" className={hide}>
                <PropSelect
                  label="Project"
                  value={draft.projectId ?? ""}
                  onChange={(v) => set("projectId", v || null)}
                  options={[
                    { value: "", label: "No project" },
                    ...projects
                      .filter((p) => p.area === draft.area || p.id === draft.projectId)
                      .map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
              </Prop>
            )}
            {!more && (
              <button
                type="button"
                onClick={() => setMore(true)}
                className="flex h-10 items-center gap-2.5 self-start text-preview text-muted-foreground md:hidden"
              >
                <ChevronDown className="size-4" aria-hidden />
                {extra} more
              </button>
            )}
          </div>

          <TaskComments taskId={initial.id} timeZone={timeZone} />

          <TaskNotes value={draft.notes} onChange={(v) => set("notes", v)} className="mt-6" />

          {draft.madeBy && draft.createdAt && (
            <p className="text-meta text-muted-foreground">
              <MadeByLabel madeBy={draft.madeBy} createdAt={draft.createdAt} />
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}

const iconButton = "flex size-10 items-center justify-center rounded-lg text-icon hover:bg-muted hover:text-foreground md:size-9";


/** One detail of the task: its name on the left, its value on the right, like Notion's properties. */
function Prop({
  icon: Icon,
  label,
  className,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-h-10 items-center gap-2", className)}>
      <span className="flex w-28 shrink-0 items-center gap-2.5 text-preview text-muted-foreground md:w-36">
        <Icon className="size-4 shrink-0" aria-hidden />
        {label}
      </span>
      <div className="flex min-w-0 grow items-center">{children}</div>
    </div>
  );
}

const plainField =
  "h-9 max-w-full cursor-pointer appearance-none truncate rounded-lg border-0 bg-transparent px-2 -ml-2 text-control text-foreground outline-none hover:bg-muted focus-visible:bg-muted md:text-preview";

/** A value picked from a list, shown as plain text until it's tapped. */
function PropSelect<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      aria-label={label}
      className={cn(plainField, !value && "text-muted-foreground")}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** The due date as words ("Tomorrow", "Fri 31 Oct"); tapping it opens the calendar. */
function DuePicker({ value, today, onChange }: { value: string | null; today: string; onChange: (value: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="relative flex items-center">
      <button
        type="button"
        onClick={() => input.current?.showPicker?.()}
        className={cn(plainField, "flex items-center", !value && "text-muted-foreground")}
      >
        {value ? friendlyDay(value, today) : "No date"}
      </button>
      {/* The real date field sits under the words, so phones open their own date wheel. */}
      <input
        ref={input}
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label="Due date"
        tabIndex={-1}
        className="pointer-events-none absolute inset-0 opacity-0 max-md:pointer-events-auto"
      />
      {value && (
        <button type="button" onClick={() => onChange(null)} aria-label="Clear due date" title="Clear due date" className="ml-1 flex size-8 items-center justify-center rounded-lg text-icon hover:bg-muted">
          <X className="size-4" aria-hidden />
        </button>
      )}
    </span>
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
  return (
    <div className="mt-4 border-t pt-4">
      <Comments target={{ type: "task", id: taskId }} threads={threads} timeZone={timeZone} onChanged={load} />
    </div>
  );
}
