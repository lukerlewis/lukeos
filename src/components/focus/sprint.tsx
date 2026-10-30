"use client";

import { Check, ListChecks, Plus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusIcon } from "@/components/tasks/status-circle";
import { FocusChip, PriorityChip, ProjectChip } from "@/components/tasks/task-chips";
import { tableColumns, useColumnWidths } from "@/components/tasks/task-list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { inBackground } from "@/lib/background";
import { op } from "@/lib/ops-client";
import { currentArea } from "@/lib/area";
import { bucketLabel, buckets, type Bucket, type Effort, type Priority } from "@/lib/task-fields";
import { cn } from "@/lib/utils";
import { SPRINT_MINUTES, useFocus, type SprintTask } from "./focus-provider";

/** An open task Luke could pull into a sprint. */
export type PickableTask = {
  id: string;
  title: string;
  bucket: Bucket;
  effort: Effort | null;
  priority: Priority | null;
  project: { name: string; hex: string } | null;
};

const isNew = (id: string) => id.startsWith("new:");
/** New tasks ticked or unticked before they finished saving: temporary id to done. */
const tickedEarly = new Map<string, boolean>();

/**
 * The sprint's tasks: picked or typed before it starts, ticked off while it
 * runs. Ticking one marks the task itself done everywhere.
 */
export function SprintTasks({ openTasks }: { openTasks: PickableTask[] }) {
  const router = useRouter();
  const focus = useFocus();
  const [title, setTitle] = useState("");
  const [picking, setPicking] = useState(false);
  if (!focus) return null;
  const { sprint, setSprintTasks } = focus;
  const titles = new Map(openTasks.map((t) => [t.id, t.title]));

  // A typed task is saved to Today straight away; it shows at once with a temporary id.
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    const temp = `new:${crypto.randomUUID()}`;
    setTitle("");
    setSprintTasks((ts) => [...ts, { id: temp, title: clean, done: false }]);
    void inBackground(() => op("create_task", { title: clean, area: currentArea() }), {
      then: (task) => {
        setSprintTasks((ts) => ts.map((t) => (t.id === temp ? { ...t, id: task.id } : t)));
        // Ticked off before it finished saving.
        if (tickedEarly.get(temp)) void op("update_task", { id: task.id, status: "done" }).catch(() => {});
        tickedEarly.delete(temp);
        router.refresh();
      },
      failed: () => {
        tickedEarly.delete(temp);
        setSprintTasks((ts) => ts.filter((t) => t.id !== temp));
      },
      failure: "Couldn't add the task.",
    });
  };

  const toggle = (task: SprintTask) => {
    const done = !task.done;
    const set = (value: boolean) => setSprintTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, done: value } : t)));
    set(done);
    if (isNew(task.id)) return void tickedEarly.set(task.id, done);
    void inBackground(() => op("update_task", { id: task.id, status: done ? "done" : "todo" }), {
      then: () => router.refresh(),
      failed: () => set(!done),
      failure: "Couldn't save the task.",
    });
  };

  const remove = (id: string) => setSprintTasks((ts) => ts.filter((t) => t.id !== id));

  const inSprint = new Set(sprint.tasks.map((t) => t.id));
  const pickable = openTasks.filter((t) => !inSprint.has(t.id));
  if (sprint.running && sprint.tasks.length === 0) return null;

  return (
    <Card className="w-full">
      {sprint.tasks.length > 0 && (
        <ul>
          {sprint.tasks.map((t) => (
            <SprintRow
              key={t.id}
              task={{ ...t, title: titles.get(t.id) ?? t.title }}
              started={sprint.started}
              onToggle={() => toggle(t)}
              onRemove={() => remove(t.id)}
            />
          ))}
        </ul>
      )}
      {/* Adding is for setting up or a pause; while it runs, just the checklist. */}
      {!sprint.finished && !sprint.running && (
        <>
          <form onSubmit={add} className={cn("flex items-center gap-3 px-4", sprint.tasks.length > 0 && "border-t")}>
            <Plus className="size-[18px] shrink-0 text-icon" aria-hidden />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add a task"
              aria-label="Add a task"
              enterKeyHint="done"
              className="h-12 w-0 min-w-0 grow bg-transparent text-body outline-none placeholder:text-muted-foreground md:h-11 md:text-control"
            />
          </form>
          <button
            type="button"
            onClick={() => setPicking(true)}
            disabled={pickable.length === 0}
            className="press-tint flex min-h-12 w-full items-center gap-3 border-t px-4 text-left disabled:text-disabled md:min-h-11"
          >
            <ListChecks className="size-[18px] shrink-0 text-icon" aria-hidden />
            <span className="grow text-control">Choose from tasks</span>
          </button>
        </>
      )}
      {picking && (
        <TaskPicker
          tasks={pickable}
          onClose={() => setPicking(false)}
          onPick={(picked) => {
            setPicking(false);
            setSprintTasks((ts) => [...ts, ...picked.map((t) => ({ id: t.id, title: t.title, done: false }))]);
          }}
        />
      )}
    </Card>
  );
}

function SprintRow({
  task,
  started,
  onToggle,
  onRemove,
}: {
  task: SprintTask;
  started: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  // Counts taps on the circle, so the tick animates afresh each time.
  const [taps, setTaps] = useState(0);
  return (
    <li className="flex items-start gap-3 border-b px-4 last:border-b-0">
      {started ? (
        <button
          type="button"
          onClick={() => {
            setTaps((n) => n + 1);
            onToggle();
          }}
          aria-label={task.done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
          className="-mx-2 flex size-11 shrink-0 items-center justify-center md:size-10"
        >
          <StatusIcon
            key={taps}
            status={task.done ? "done" : "todo"}
            className={cn("size-[26px] md:size-[18px]", taps > 0 && "motion-tick")}
          />
        </button>
      ) : (
        <span className="-mx-2 flex size-11 shrink-0 items-center justify-center md:size-10" aria-hidden>
          <StatusIcon status="todo" className="size-[26px] md:size-[18px]" />
        </span>
      )}
      <span
        className={cn(
          "min-w-0 grow py-3 text-control font-medium break-words md:py-2.5",
          task.done && "text-muted-foreground line-through",
        )}
      >
        {task.title}
      </span>
      {!started && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Take "${task.title}" out of the sprint`}
          className="-mr-2 flex size-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground md:size-10"
        >
          <X className="size-4" />
        </button>
      )}
    </li>
  );
}

/**
 * Pick any number of open tasks, grouped by list. On computers each list is the same table as the
 * dashboard (focus type, priority, name, project, sharing its column widths); phones show the chips under the name.
 */
function TaskPicker({
  tasks,
  onClose,
  onPick,
}: {
  tasks: PickableTask[];
  onClose: () => void;
  onPick: (tasks: PickableTask[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  useColumnWidths(true);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = q ? tasks.filter((t) => t.title.toLowerCase().includes(q)) : tasks;
    return buckets.map((b) => ({ bucket: b, tasks: shown.filter((t) => t.bucket === b) })).filter((g) => g.tasks.length);
  }, [tasks, query]);

  const flip = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog label="Choose tasks" onClose={onClose} focusFirstField={false} className="overflow-hidden sm:max-w-3xl">
      <div className="flex max-h-[92dvh] flex-col sm:max-h-[85dvh]">
      <div className="flex flex-col gap-3 border-b p-4">
        <h2 className="text-heading font-medium text-ink">Choose tasks</h2>
        <label className="flex h-11 items-center gap-2 rounded-lg border bg-card px-3">
          <Search className="size-4 shrink-0 text-icon" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search tasks"
            className="w-0 min-w-0 grow bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-control"
          />
        </label>
      </div>
      <div className="min-h-0 grow overflow-y-auto">
        {groups.map((g) => (
          <section key={g.bucket}>
            <h3 className="px-4 pt-4 pb-1 text-meta text-muted-foreground">{bucketLabel[g.bucket]}</h3>
            <div
              aria-hidden
              className="hidden border-y bg-muted/40 px-4 text-xs font-medium text-muted-foreground md:grid"
              style={{ gridTemplateColumns: tableColumns(true) }}
            >
              <span />
              <span className={headCell}>Focus type</span>
              <span className={headCell}>Priority</span>
              <span className={cn(headCell, "pl-3")}>Name</span>
              <span className={headCell}>Project</span>
            </div>
            <ul>
              {g.tasks.map((t) => {
                const on = picked.has(t.id);
                const chips = t.effort || t.priority || t.project;
                return (
                  <li key={t.id} className="border-b last:border-b-0">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => flip(t.id)}
                      className="press-tint flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left md:grid md:min-h-11 md:items-stretch md:gap-0 md:py-0"
                      style={{ gridTemplateColumns: tableColumns(true) }}
                    >
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center self-center rounded-md border border-stroke-strong",
                          on && "border-primary bg-primary text-primary-foreground",
                        )}
                        aria-hidden
                      >
                        {on && <Check className="size-3.5" strokeWidth={3} />}
                      </span>
                      <span className={cell}>{t.effort && <FocusChip effort={t.effort} />}</span>
                      <span className={cell}>{t.priority && <PriorityChip priority={t.priority} />}</span>
                      <span className="flex min-w-0 grow flex-col gap-1 md:justify-center md:border-l md:px-3 md:py-2">
                        <span className="text-control break-words text-foreground md:truncate">{t.title}</span>
                        {chips && (
                          <span className="flex flex-wrap items-center gap-1.5 md:hidden">
                            {t.effort && <FocusChip effort={t.effort} />}
                            {t.priority && <PriorityChip priority={t.priority} />}
                            {t.project && <ProjectChip project={t.project} />}
                          </span>
                        )}
                      </span>
                      <span className={cell}>{t.project && <ProjectChip project={t.project} />}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {groups.length === 0 && <p className="px-4 py-6 text-control text-muted-foreground">No tasks</p>}
      </div>
      <div className="flex justify-end gap-2 border-t p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={picked.size === 0} onClick={() => onPick(tasks.filter((t) => picked.has(t.id)))}>
          {picked.size ? `Add ${picked.size}` : "Add"}
        </Button>
      </div>
      </div>
    </Dialog>
  );
}

const headCell = "border-l px-2 py-1.5";
/** A table cell in the picker, computers only. */
const cell = "hidden min-w-0 items-center overflow-hidden border-l px-2 md:flex";

/**
 * A place to jot down whatever comes to mind mid-sprint, so it's out of Luke's
 * head without leaving the sprint. Saves as he types and stays until he clears it.
 */
export function ScratchPad({ text: saved }: { text: string }) {
  const [text, setText] = useState(saved);
  const [prev, setPrev] = useState(saved);
  const [focused, setFocused] = useState(false);
  const last = useRef(saved);
  const latest = useRef(saved);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Claude (or another device) changed it: show that, unless Luke is typing.
  if (saved !== prev) {
    setPrev(saved);
    if (!focused) setText(saved);
  }

  const save = useCallback(() => {
    clearTimeout(timer.current);
    const value = latest.current;
    if (value === last.current) return;
    last.current = value;
    void inBackground(() => op("update_scratch_pad", { text: value }), { failure: "Couldn't save the scratch pad." });
  }, []);

  // Anything typed in the last moment is saved when Luke leaves the screen.
  useEffect(() => {
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [save]);

  return (
    <Card className="w-full">
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          latest.current = e.target.value;
          clearTimeout(timer.current);
          timer.current = setTimeout(save, 600);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          save();
        }}
        placeholder="Scratch pad"
        aria-label="Scratch pad"
        rows={3}
        className="field-sizing-content block max-h-72 min-h-24 w-full resize-none bg-transparent px-4 py-3 text-body outline-none placeholder:text-muted-foreground md:text-control"
      />
    </Card>
  );
}

/** Tapping the time before a sprint starts: type the length. */
export function SprintLengthDialog({ minutes, onClose }: { minutes: number; onClose: () => void }) {
  const focus = useFocus();
  const [value, setValue] = useState(String(minutes));
  return (
    <Dialog label="Sprint length" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          focus?.setSprintMinutes(Number(value));
          onClose();
        }}
        className="flex flex-col gap-5 p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]"
      >
        <h2 className="text-heading font-medium text-ink">Sprint length</h2>
        <label className="flex items-center gap-3">
          <span className="grow text-control text-foreground">Minutes</span>
          <input
            type="number"
            inputMode="numeric"
            min={SPRINT_MINUTES.min}
            max={SPRINT_MINUTES.max}
            required
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-11 w-24 rounded-lg border bg-card px-3 text-right text-base tabular-nums md:text-control"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  );
}
