"use client";

import { Check, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { showToast } from "@/components/shell/toast";
import { useTaskEditor } from "@/components/tasks/task-editor";
import { EmptyState } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ClaudeItem } from "@/core/from-claude";
import { op } from "@/lib/ops-client";
import { effortLabel, efforts, priorities, priorityLabel, statuses, statusLabel } from "@/lib/task-fields";
import { cn } from "@/lib/utils";
import { ItemBody } from "./item-list";

type ProjectChoice = { id: string; name: string };

const dueChoices = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "this_week", label: "This week" },
  { value: "later", label: "Later" },
] as const;

/**
 * Claude's tasks or artifacts, with Select to pick several and change them all at
 * once: move to Trash, put in a project, and for tasks status, due, priority
 * and effort.
 */
export function SelectableClaudeList({
  items,
  when,
  kind,
  projects,
  empty,
}: {
  items: ClaudeItem[];
  when: Record<string, string>;
  kind: "task" | "artifact";
  projects: ProjectChoice[];
  empty: React.ReactNode;
}) {
  const router = useRouter();
  const { openTask } = useTaskEditor();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const ids = [...picked].filter((id) => items.some((i) => i.id === id));
  const allPicked = ids.length === items.length && items.length > 0;
  const noun = (n: number) => `${n} ${kind}${n === 1 ? "" : "s"}`;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const stop = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  async function run(action: () => Promise<{ count: number }>, message: (n: number) => string, undo?: () => Promise<void>) {
    setBusy(true);
    try {
      const { count } = await action();
      showToast(message(count), undo);
      stop();
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const trash = () => {
    const chosen = ids;
    return run(
      () => (kind === "task" ? op("delete_tasks", { ids: chosen }) : op("delete_artifacts", { ids: chosen })),
      (n) => `${noun(n)} moved to Trash`.replace(/^./, (c) => c.toUpperCase()),
      async () => {
        for (const id of chosen) await op("restore_from_trash", { type: kind, id });
        router.refresh();
      },
    );
  };

  const setProject = (value: string) => {
    const projectId = value === "none" ? null : value;
    const name = projects.find((p) => p.id === projectId)?.name;
    return run(
      () => (kind === "task" ? op("update_tasks", { ids, projectId }) : op("update_artifacts", { ids, projectId })),
      (n) => (name ? `Moved ${noun(n)} to ${name}` : `Took ${noun(n)} out of their project`),
    );
  };

  const setTaskField = (changes: Omit<Parameters<typeof op<"update_tasks">>[1], "ids">, label: string) =>
    run(() => op("update_tasks", { ...changes, ids }), (n) => `${label} for ${noun(n)}`);

  const moveTasks = (to: (typeof dueChoices)[number]["value"]) =>
    run(
      () => op("move_tasks", { ids, to }),
      (n) => (n === 0 ? "Those tasks were already there" : `Moved ${noun(n)} to ${dueChoices.find((d) => d.value === to)?.label}`),
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-9 items-center justify-between gap-3">
        {selecting ? (
          <>
            <span className="text-[13px] font-medium">{ids.length === 0 ? `Select ${kind}s` : `${noun(ids.length)} selected`}</span>
            <span className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPicked(allPicked ? new Set() : new Set(items.map((i) => i.id)))}
              >
                {allPicked ? "Select none" : "Select all"}
              </Button>
              <Button variant="outline" size="sm" onClick={stop}>
                Done
              </Button>
            </span>
          </>
        ) : (
          <>
            <span />
            <Button variant="outline" size="sm" onClick={() => setSelecting(true)} disabled={items.length === 0}>
              Select
            </Button>
          </>
        )}
      </div>

      <Card>
        {items.length === 0 ? (
          <EmptyState>{empty}</EmptyState>
        ) : (
        <ul>
          {items.map((item) => {
            const on = picked.has(item.id);
            const body = <ItemBody item={item} when={when[item.id]} />;
            const row = "flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50";
            return (
              <li key={item.id} className={cn("border-b last:border-b-0", on && "bg-muted/60")}>
                {selecting ? (
                  <button type="button" className={row} aria-pressed={on} onClick={() => toggle(item.id)}>
                    <span
                      className={cn(
                        "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border md:size-4",
                        on ? "border-primary bg-primary text-primary-foreground" : "bg-card",
                      )}
                      aria-hidden
                    >
                      {on && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    {body}
                  </button>
                ) : item.type === "task" ? (
                  <button
                    type="button"
                    className={row}
                    onClick={async () => {
                      try {
                        openTask(await op("get_task", { id: item.id }));
                      } catch (err) {
                        alert((err as Error).message);
                      }
                    }}
                  >
                    {body}
                  </button>
                ) : (
                  <Link href={`/artifacts/${item.id}`} className={row}>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        )}
      </Card>

      {selecting && ids.length > 0 && (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-10 mt-1 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2 shadow-lg md:bottom-4">
          <Picker label="Project" disabled={busy} onPick={setProject}>
            <option value="none">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Picker>
          {kind === "task" && (
            <>
              <Picker label="Status" disabled={busy} onPick={(v) => setTaskField({ status: v as (typeof statuses)[number] }, `Status set to ${statusLabel[v as (typeof statuses)[number]]}`)}>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel[s]}
                  </option>
                ))}
              </Picker>
              <Picker label="Due" disabled={busy} onPick={(v) => moveTasks(v as (typeof dueChoices)[number]["value"])}>
                {dueChoices.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Picker>
              <Picker
                label="Priority"
                disabled={busy}
                onPick={(v) =>
                  setTaskField(
                    { priority: v === "none" ? null : (v as (typeof priorities)[number]) },
                    v === "none" ? "Priority cleared" : `Priority set to ${priorityLabel[v as (typeof priorities)[number]]}`,
                  )
                }
              >
                <option value="none">None</option>
                {priorities.map((p) => (
                  <option key={p} value={p}>
                    {priorityLabel[p]}
                  </option>
                ))}
              </Picker>
              <Picker
                label="Effort"
                disabled={busy}
                onPick={(v) =>
                  setTaskField(
                    { effort: v === "none" ? null : (v as (typeof efforts)[number]) },
                    v === "none" ? "Effort cleared" : `Effort set to ${effortLabel[v as (typeof efforts)[number]]}`,
                  )
                }
              >
                <option value="none">None</option>
                {efforts.map((e) => (
                  <option key={e} value={e}>
                    {effortLabel[e]}
                  </option>
                ))}
              </Picker>
            </>
          )}
          <Button variant="danger" size="sm" className="ml-auto" disabled={busy} onClick={trash}>
            <Trash2 className="size-4" aria-hidden />
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}

/** A small menu that looks like a button: pick an option and it's applied straight away. */
function Picker({
  label,
  disabled,
  onPick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onPick: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      aria-label={label}
      value=""
      disabled={disabled}
      onChange={(e) => e.target.value && onPick(e.target.value)}
      className="h-8 rounded-lg border bg-card px-2.5 text-[13px] font-medium shadow-xs disabled:opacity-50"
    >
      <option value="" disabled>
        {label}
      </option>
      {children}
    </select>
  );
}
