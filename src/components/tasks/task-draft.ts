import type { Project } from "@/core/projects";
import type { Task } from "@/core/tasks";
import { colorHex } from "@/lib/project-colors";
import { repeats, type Area, type Bucket, type Effort, type Lane, type Priority, type Repeat, type Status, type TimeOfDay } from "@/lib/task-fields";

/** A task as the editor holds it while it's open. */
export type Draft = {
  id?: string;
  title: string;
  projectId: string | null;
  status: Status;
  bucket: Bucket;
  dueDate: string | null;
  priority: Priority | null;
  effort: Effort | null;
  area: Area;
  timeOfDay: TimeOfDay;
  lane: Lane;
  repeat: Repeat | null;
  notes: string;
  madeBy?: Task["madeBy"];
  createdAt?: Task["createdAt"];
  /** The task as it was opened, so lists can show changes before they're saved. */
  base?: Task;
  /** Why the last try to add it failed, when it's reopened to try again. */
  error?: string;
};

/** The fields saved for a task. */
export type DraftFields = Pick<
  Draft,
  "projectId" | "status" | "bucket" | "dueDate" | "priority" | "effort" | "area" | "timeOfDay" | "lane" | "repeat"
> & { title: string; notes: string | null };

/** The repeat menu: the usual ones, a couple with gaps, and whatever the task has if it's none of those ("every 3 days"). */
export function repeatChoices(current: Repeat | null): Repeat[] {
  const list: Repeat[] = [...repeats.slice(0, 2), "every_2_days", ...repeats.slice(2, 3), "every_2_weeks", ...repeats.slice(3)];
  return current && !list.includes(current) ? [...list, current] : list;
}

let unsavedCount = 0;

/**
 * The task as lists should show it: the box's fields on top of how it was opened,
 * or, for a new one, a stand-in until the saved task arrives.
 */
export function asTask(fields: DraftFields, projects: Project[], base?: Task): Task {
  const { projectId, ...rest } = fields;
  const project = projects.find((p) => p.id === projectId);
  const now = new Date();
  return {
    id: base?.id ?? `unsaved-${++unsavedCount}`,
    cardId: base?.cardId ?? null,
    createdAt: base?.createdAt ?? now,
    updatedAt: base?.updatedAt ?? now,
    madeBy: base?.madeBy ?? { kind: "user", name: null, routine: null },
    ...rest,
    title: fields.title || base?.title || "",
    // A task in a project is in that project's area.
    area: project?.area ?? fields.area,
    project: project ? { id: project.id, name: project.name, color: project.color, hex: colorHex(project.color) } : null,
    completedAt: fields.status === "done" ? (base?.completedAt ?? now) : null,
  };
}
