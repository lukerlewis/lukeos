"use client";

import { Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@/core/projects";
import type { Task } from "@/core/tasks";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { addDays, endOfWeek } from "@/lib/dates";
import { showTrashedToast } from "@/components/shell/toast";
import { op } from "@/lib/ops-client";
import {
  effortLabel,
  efforts,
  priorities,
  priorityLabel,
  repeats,
  statuses,
  statusLabel,
  type Effort,
  type Priority,
  type Repeat,
  type Status,
} from "@/lib/task-fields";
import { MadeByLabel } from "./made-by";

type Draft = {
  id?: string;
  title: string;
  projectId: string | null;
  status: Status;
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
  /** Start a new task, optionally in a project or due on a day. */
  newTask: (defaults?: Partial<Pick<Draft, "title" | "projectId" | "dueDate" | "status">>) => void;
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
  children,
}: {
  projects: Project[];
  today: string;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);

  const openTask = useCallback((t: Task) => {
    setDraft({
      id: t.id,
      title: t.title,
      projectId: t.project?.id ?? null,
      status: t.status,
      dueDate: t.dueDate,
      priority: t.priority,
      effort: t.effort,
      repeat: t.repeat,
      notes: t.notes ?? "",
      madeBy: t.madeBy,
      createdAt: t.createdAt,
    });
  }, []);

  const newTask = useCallback<Editor["newTask"]>((defaults) => {
    setDraft({
      title: defaults?.title ?? "",
      projectId: defaults?.projectId ?? null,
      status: defaults?.status ?? "todo",
      dueDate: defaults?.dueDate ?? null,
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
        <TaskDialog key={draft.id ?? "new"} initial={draft} projects={projects} today={today} onClose={() => setDraft(null)} />
      )}
    </EditorContext>
  );
}

function TaskDialog({
  initial,
  projects,
  today,
  onClose,
}: {
  initial: Draft;
  projects: Project[];
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const isNew = !initial.id;

  useEffect(() => {
    if (isNew) titleRef.current?.focus();
  }, [isNew]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!draft.title.trim()) {
      setError("Give the task a name.");
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const fields = {
      title: draft.title.trim(),
      projectId: draft.projectId,
      status: draft.status,
      dueDate: draft.dueDate,
      priority: draft.priority,
      effort: draft.effort,
      repeat: draft.repeat,
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
    <Dialog label={isNew ? "New task" : "Task"} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col">
        <div className="flex items-start gap-2 px-5 pt-4">
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
            className="field-sizing-content min-h-9 grow resize-none bg-transparent py-1 text-lg font-semibold outline-none placeholder:text-muted-foreground"
          />
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="-mr-2 shrink-0">
            <X className="size-5" aria-hidden />
          </Button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <Field label="Status">
            <Segmented
              value={draft.status}
              onChange={(v) => set("status", v)}
              options={statuses.map((s) => ({ value: s, label: statusLabel[s] }))}
            />
          </Field>

          <Field label="Due">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={draft.dueDate ?? ""}
                onChange={(e) => set("dueDate", e.target.value || null)}
                aria-label="Due date"
                className="h-9 rounded-lg border bg-card px-2.5 text-[16px] md:text-[13px] shadow-xs"
              />
              {dueChoices.map((c) => (
                <Chip key={c.label} active={draft.dueDate === c.value} onClick={() => set("dueDate", c.value)}>
                  {c.label}
                </Chip>
              ))}
              {draft.dueDate && <Chip onClick={() => set("dueDate", null)}>No date</Chip>}
            </div>
          </Field>

          <Field label="Repeat">
            <Segmented
              value={draft.repeat ?? "none"}
              onChange={(v) => set("repeat", v === "none" ? null : v)}
              options={[
                { value: "none" as const, label: "Never" },
                ...repeats.map((r) => ({ value: r, label: { daily: "Daily", weekly: "Weekly", monthly: "Monthly" }[r] })),
              ]}
            />
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

          {draft.madeBy && draft.createdAt && (
            <p className="text-xs text-muted-foreground">
              <MadeByLabel madeBy={draft.madeBy} createdAt={draft.createdAt} />
            </p>
          )}

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
