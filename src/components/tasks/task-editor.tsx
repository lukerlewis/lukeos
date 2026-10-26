"use client";

import { ChevronDown, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@/core/projects";
import type { Task } from "@/core/tasks";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { bucketForDate } from "@/lib/board";
import { currentArea } from "@/lib/area";
import { addDays, endOfWeek } from "@/lib/dates";
import { showToast } from "@/components/shell/toast";
import { inBackground } from "@/lib/background";
import { forgetTask, showTask } from "@/lib/live-tasks";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import {
  areaLabel,
  areas,
  isProjectArea,
  bucketLabel,
  buckets,
  effortLabel,
  efforts,
  priorities,
  priorityLabel,
  repeatName,
  timeOfDayLabel,
  laneLabel,
  lanes,
  timesOfDay,
  type Repeat,
} from "@/lib/task-fields";
import { asTask, repeatChoices, type Draft } from "./task-draft";
import { HighlightedText, SmartChips, useSmartEntry } from "./smart-chips";
import { FocusIcon, PriorityChip } from "./task-chips";
import { TaskNotes } from "./task-notes";
import { TaskPeek } from "./task-peek";

type Editor = {
  /** Open an existing task to view and change it. */
  openTask: (task: Task) => void;
  /** The task open right now, if any, so lists can mark it. */
  openId: string | null;
  /** Start a new task, optionally in a project or list. */
  newTask: (defaults?: Partial<Pick<Draft, "title" | "projectId" | "bucket" | "status" | "area" | "timeOfDay" | "lane">>) => void;
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
      area: t.area,
      timeOfDay: t.timeOfDay,
      lane: t.lane,
      repeat: t.repeat,
      notes: t.notes ?? "",
      madeBy: t.madeBy,
      createdAt: t.createdAt,
      base: t,
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

  const newTask = useCallback<Editor["newTask"]>(
    (defaults) => {
      // A new task goes in Today unless the screen picked a list, and in its project's area, else the one this device shows.
      const project = projects.find((p) => p.id === defaults?.projectId);
      setDraft({
        title: defaults?.title ?? "",
        projectId: defaults?.projectId ?? null,
        status: defaults?.status ?? "todo",
        bucket: defaults?.bucket ?? "today",
        dueDate: null,
        priority: null,
        effort: null,
        area: project?.area ?? defaults?.area ?? currentArea(),
        timeOfDay: defaults?.timeOfDay ?? "day",
        lane: defaults?.lane ?? "noise",
        repeat: null,
        notes: "",
      });
    },
    [projects],
  );

  return (
    <EditorContext value={{ openTask, newTask, openId: draft?.id ?? null }}>
      {children}
      {draft && (
        (draft.id ? (
          <TaskPeek
            key={draft.id}
            initial={{ ...draft, id: draft.id }}
            projects={projects}
            today={today}
            timeZone={timeZone}
            // Only if it's still the one open: clicking another task while this one slides away opens that one.
            onClose={() => setDraft((open) => (open?.id === draft.id ? null : open))}
          />
        ) : (
          <TaskDialog
            key="new"
            initial={draft}
            projects={projects}
            today={today}
            onClose={() => setDraft(null)}
            // Unless another task is open by then: the toast has already said it didn't save.
            onFailed={(d) => setDraft((open) => open ?? d)}
          />
        ))
      )}
    </EditorContext>
  );
}

/** Adding a task: a sheet from the bottom on phones, a box in the middle on computers. */
function TaskDialog({
  initial,
  projects,
  today,
  onClose,
  onFailed,
}: {
  initial: Draft;
  projects: Project[];
  today: string;
  onClose: () => void;
  /** A new task that didn't save comes back here, so nothing typed is lost. */
  onFailed: (draft: Draft) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(initial.error ?? null);
  // Adding a task on a phone shows just the name; the rest is behind "Show more".
  const [more, setMore] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  // A new task's name is read for dates and repeats ("laundry tomorrow"); picking a day by hand wins over it.
  const smart = useSmartEntry(draft.title, today);
  const [dueTouched, setDueTouched] = useState(false);
  const { parsed } = smart;
  const dueDate = dueTouched ? draft.dueDate : (parsed.dueDate ?? (parsed.repeat ? (draft.dueDate ?? today) : draft.dueDate));
  const repeat = parsed.repeat ?? draft.repeat;
  // A new task's list follows a list typed in its name ("later"), else its due date, until a list is picked by hand.
  const [bucketTouched, setBucketTouched] = useState(false);
  const bucket =
    !bucketTouched ? (parsed.bucket ?? (dueDate ? bucketForDate(dueDate, today) : draft.bucket)) : draft.bucket;
  const highlight = parsed.matches.length > 0;

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
    titleRef.current?.focus();
  }, []);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const fields = {
    title: parsed.title,
    projectId: draft.projectId,
    status: draft.status,
    bucket,
    dueDate,
    priority: draft.priority,
    effort: draft.effort,
    area: draft.area,
    timeOfDay: draft.timeOfDay,
    lane: draft.lane,
    repeat,
    notes: draft.notes.trim() || null,
  };

  function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!parsed.title) {
      setError("Give the task a name.");
      titleRef.current?.focus();
      return;
    }
    // The box closes at once; the task saves behind it and a toast says when it's in.
    const keep = { ...draft, dueDate, repeat, bucket };
    onClose();
    // It shows in its list at once, faded, until it's saved.
    const unsaved = asTask(fields, projects);
    showTask(unsaved);
    void inBackground(() => op("create_task", fields), {
      then: (task) => {
        forgetTask(unsaved.id);
        showTask(task);
        showToast(bucket === "today" ? "Task added" : `Task added to ${bucketLabel[bucket]}`);
        router.refresh();
      },
      failed: (err) => {
        forgetTask(unsaved.id);
        onFailed({ ...keep, error: `Not added yet: ${err.message}` });
      },
      failure: "Couldn't add the task.",
    });
  }

  const dueChoices = [
    { label: "Today", value: today },
    { label: "Tomorrow", value: addDays(today, 1) },
    { label: "This weekend", value: endOfWeek(today) === today ? today : addDays(endOfWeek(today), -1) },
    { label: "Next week", value: addDays(endOfWeek(today), 1) },
  ];

  return (
    <Dialog label="New task" onClose={onClose}>
      <form onSubmit={save} className="flex flex-col">
        <div className="flex items-start gap-2 px-5 pt-4">
          <div className="grid min-w-0 grow">
            {highlight && (
              <div
                aria-hidden
                className="pointer-events-none col-start-1 row-start-1 py-1 text-lg font-medium break-words whitespace-pre-wrap"
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
                "col-start-1 row-start-1 field-sizing-content min-h-9 resize-none bg-transparent py-1 text-lg font-medium break-words outline-none placeholder:text-muted-foreground",
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
            className="mx-5 mt-3 flex items-center gap-1 self-start text-meta font-medium text-muted-foreground md:hidden"
          >
            Show more
            <ChevronDown className="size-4" aria-hidden />
          </button>
        )}

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className={cn("flex-col gap-4", more ? "flex" : "hidden md:flex")}>
            <Field label="Area">
              <Segmented
                value={draft.area}
                onChange={(v) => {
                  // A project belongs to one area, so moving the task to the other one takes it out.
                  if (draft.projectId && projects.find((p) => p.id === draft.projectId)?.area !== v) set("projectId", null);
                  set("area", v);
                }}
                options={areas.map((a) => ({ value: a, label: areaLabel[a] }))}
              />
            </Field>

            <Field label="List">
              <Segmented
                value={bucket}
                onChange={(v) => {
                  if (parsed.bucket) smart.dismiss("list");
                  setBucketTouched(true);
                  set("bucket", v);
                }}
                options={buckets.map((b) => ({ value: b, label: bucketLabel[b] }))}
              />
            </Field>

            {/* Life's Today is split into Morning, Day and Evening. */}
            {draft.area === "life" && (
              <Field label="Time">
                <Segmented
                  value={draft.timeOfDay}
                  onChange={(v) => set("timeOfDay", v)}
                  options={timesOfDay.map((x) => ({ value: x, label: timeOfDayLabel[x] }))}
                />
              </Field>
            )}

            {/* Work's Today is split into Signal and Noise. */}
            {draft.area === "work" && (
              <Field label="Card">
                <Segmented
                  value={draft.lane}
                  onChange={(v) => set("lane", v)}
                  options={lanes.map((x) => ({ value: x, label: laneLabel[x] }))}
                />
              </Field>
            )}

            <Field label="Due">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={dueDate ?? ""}
                  onChange={(e) => pickDue(e.target.value || null)}
                  aria-label="Due date"
                  className="h-9 rounded-lg border bg-card px-2.5 text-body md:text-meta border-stroke-strong"
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
                className="h-9 w-full rounded-lg border bg-card px-2.5 text-body md:text-meta border-stroke-strong sm:w-auto sm:min-w-56"
              >
                <option value="">Never</option>
                {repeatChoices(repeat).map((r) => (
                  <option key={r} value={r}>
                    {repeatName(r)}
                  </option>
                ))}
              </select>
            </Field>

            {/* Focus type is for Aya and Work; Life keeps it simple. One already set still shows, so it can be cleared. */}
            {(isProjectArea(draft.area) || draft.effort) && (
              <Field label="Focus">
                <Segmented
                  value={draft.effort ?? "none"}
                  onChange={(v) => set("effort", v === "none" ? null : v)}
                  options={[
                    { value: "none" as const, label: "None" },
                    ...efforts.map((x) => ({
                      value: x,
                      label: (
                        <>
                          <FocusIcon effort={x} className="size-3.5" />
                          {effortLabel[x]}
                        </>
                      ),
                    })),
                  ]}
                />
              </Field>
            )}

            <Field label="Priority">
              <Segmented
                value={draft.priority ?? "none"}
                onChange={(v) => set("priority", v === "none" ? null : v)}
                options={[
                  { value: "none" as const, label: "None" },
                  ...priorities.map((p) => ({ value: p, label: <PriorityChip priority={p} />, title: priorityLabel[p] })),
                ]}
              />
            </Field>

            {/* Projects are all in Aya or Work, so Life tasks don't get the choice. */}
            {(isProjectArea(draft.area) || draft.projectId) && (
              <Field label="Project">
                <select
                  value={draft.projectId ?? ""}
                  onChange={(e) => set("projectId", e.target.value || null)}
                  aria-label="Project"
                  className="h-9 w-full rounded-lg border bg-card px-2.5 text-body md:text-meta border-stroke-strong sm:w-auto sm:min-w-56"
                >
                  <option value="">No project</option>
                  {projects.filter((p) => p.area === draft.area || p.id === draft.projectId).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Notes">
              <TaskNotes value={draft.notes} onChange={(v) => set("notes", v)} className="rounded-lg border border-stroke-strong px-3" />
            </Field>
          </div>

          {error && (
            <p role="alert" className="text-meta text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <div className="grow" />
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Add task</Button>
        </div>
      </form>
    </Dialog>
  );
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
      className="h-9 rounded-lg border border-stroke px-3 text-preview font-medium text-subtle-foreground hover:bg-muted aria-pressed:border-transparent aria-pressed:bg-selected aria-pressed:text-ink"
    >
      {children}
    </button>
  );
}

