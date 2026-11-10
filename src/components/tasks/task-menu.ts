"use client";

import { Circle, CircleCheck, Copy, FolderInput, Flame, ListTodo, PanelRightOpen, Rows3, Target, Trash2 } from "lucide-react";
import type { Task } from "@/core/tasks";
import type { MenuEntry } from "@/components/ui/context-menu";
import { trashInBackground } from "@/lib/background";
import { showTask } from "@/lib/live-tasks";
import { copyLinkItem, projectItems, tryOp } from "@/lib/menus";
import { op } from "@/lib/ops-client";
import {
  bucketLabel,
  buckets,
  effortLabel,
  efforts,
  laneLabel,
  lanes,
  priorities,
  priorityLabel,
  type Area,
  type Bucket,
  type Effort,
  type Lane,
  type Priority,
  type Status,
} from "@/lib/task-fields";

type Change = { status?: Status; bucket?: Bucket; priority?: Priority | null; effort?: Effort | null; lane?: Lane; projectId?: string | null; area?: Area };

/**
 * The right-click menu for a task, wherever it shows: open, tick off, move
 * to another list or project, set its priority and focus type (Work),
 * duplicate, copy a link and delete.
 */
export function taskMenu(task: Task, { open, refresh, toggle }: { open: () => void; refresh: () => void; toggle?: () => void }): MenuEntry[] {
  const set = (change: Change) =>
    tryOp(async () => {
      const updated = await op("update_task", { id: task.id, ...change });
      showTask(updated);
    }, refresh);
  const done = task.status === "done";
  const work = task.area === "work";

  return [
    { label: "Open", icon: PanelRightOpen, onSelect: open },
    {
      label: done ? "Mark as not done" : "Mark as done",
      icon: done ? Circle : CircleCheck,
      onSelect: toggle ?? (() => set({ status: done ? "todo" : "done" })),
    },
    "-",
    {
      label: "Move to",
      icon: ListTodo,
      items: buckets.map((b) => ({ label: bucketLabel[b], checked: task.bucket === b, onSelect: () => task.bucket !== b && set({ bucket: b }) })),
    },
    work &&
      task.bucket === "today" && {
        label: "Today card",
        icon: Rows3,
        items: lanes.map((l) => ({ label: laneLabel[l], checked: task.lane === l, onSelect: () => task.lane !== l && set({ lane: l }) })),
      },
    work && {
      label: "Priority",
      icon: Flame,
      items: [
        ...[...priorities].reverse().map((p) => ({ label: priorityLabel[p], checked: task.priority === p, onSelect: () => task.priority !== p && set({ priority: p }) })),
        { label: "None", checked: !task.priority, onSelect: () => task.priority && set({ priority: null }) },
      ],
    },
    work && {
      label: "Focus type",
      icon: Target,
      items: [
        ...[...efforts].reverse().map((e) => ({ label: effortLabel[e], checked: task.effort === e, onSelect: () => task.effort !== e && set({ effort: e }) })),
        { label: "None", checked: !task.effort, onSelect: () => task.effort && set({ effort: null }) },
      ],
    },
    {
      label: "Project",
      icon: FolderInput,
      items: projectItems(task.project?.id, (projectId) => set(projectId ? { projectId } : { projectId: null })),
    },
    "-",
    {
      label: "Duplicate",
      icon: Copy,
      onSelect: () =>
        tryOp(
          () =>
            op("create_task", {
              title: task.title,
              projectId: task.project?.id ?? null,
              cardId: task.cardId ?? undefined,
              area: task.area,
              bucket: task.bucket,
              dueDate: task.dueDate,
              priority: task.priority,
              effort: task.effort,
              timeOfDay: task.timeOfDay,
              lane: task.lane,
              repeat: task.repeat,
              notes: task.notes ?? undefined,
            }),
          refresh,
        ),
    },
    copyLinkItem(`/?task=${task.id}`),
    "-",
    {
      label: "Delete",
      icon: Trash2,
      onSelect: () => trashInBackground("task", task.id, () => op("delete_task", { id: task.id }), { then: refresh }),
    },
  ];
}
