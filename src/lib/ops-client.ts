import type { z } from "zod";
import type { OperationName, Operations } from "@/core/operations";
import { pushUndo } from "./undo";

type Input<N extends OperationName> = z.input<Operations[N]["input"]>;
type Output<N extends OperationName> = Awaited<ReturnType<Operations[N]["run"]>>;

/**
 * Runs an operation from the browser, as Luke. Throws with a readable message on failure.
 * Changes that can be taken back are remembered, so Cmd+Z undoes them.
 */
export async function op<N extends OperationName>(name: N, input: Input<N>): Promise<Output<N>> {
  const before = await snapshot(name, input as Record<string, unknown>);
  const result = await send(name, input);
  const undo = undoFor(name, input as Record<string, unknown>, result, before);
  if (undo) pushUndo(undo.label, undo.run);
  return result;
}

async function send<N extends OperationName>(name: N, input: Input<N>): Promise<Output<N>> {
  const res = await fetch(`/api/ops/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Something went wrong. Try again.");
  return body;
}

type TaskSnapshot = Output<"get_task">;

/** How a task looked, as update_task input, so putting it back is one call. */
const taskFields = (t: TaskSnapshot) => ({
  id: t.id,
  title: t.title,
  projectId: t.project?.id ?? null,
  status: t.status,
  bucket: t.bucket,
  dueDate: t.dueDate,
  priority: t.priority,
  effort: t.effort,
  repeat: t.repeat,
  notes: t.notes,
});

const quote = (title: string | null | undefined) => {
  const t = (title ?? "").trim() || "Untitled";
  return `“${t.length > 40 ? `${t.slice(0, 39)}…` : t}”`;
};

const plural = (n: number, kind: string) => `${n} ${kind}${n === 1 ? "" : "s"}`;

/** Reads what a change is about to overwrite. Undo still works for everything else if this fails. */
async function snapshot(name: OperationName, input: Record<string, unknown>) {
  try {
    switch (name) {
      case "update_task":
      case "move_task":
        return [await send("get_task", { id: input.id as string })];
      case "update_tasks":
      case "move_tasks":
        return await Promise.all((input.ids as string[]).map((id) => send("get_task", { id })));
      case "update_notes":
        return await Promise.all((input.ids as string[]).map((id) => send("get_note", { id })));
      case "update_artifact":
        return [await send("get_artifact", { id: input.id as string })];
      case "update_artifacts":
        return await Promise.all((input.ids as string[]).map((id) => send("get_artifact", { id })));
      case "update_project":
        return [await send("get_project", { id: input.id as string })];
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function undoFor(
  name: OperationName,
  input: Record<string, unknown>,
  result: unknown,
  before: unknown[] | null,
): { label: string; run: () => Promise<void> } | null {
  const r = result as { id: string; title?: string; name?: string };
  switch (name) {
    case "create_task":
      return { label: `adding task ${quote(r.title)}`, run: async () => void (await send("delete_task", { id: r.id })) };
    case "create_note":
      return { label: `adding note ${quote(r.title)}`, run: async () => void (await send("delete_note", { id: r.id })) };
    case "create_routine":
      return { label: `adding routine ${quote(r.title)}`, run: async () => void (await send("delete_routine", { id: r.id })) };
    case "create_archive_entry":
      return {
        label: `adding ${quote(r.title)} to the Work archive`,
        run: async () => void (await send("delete_archive_entry", { id: r.id })),
      };
    case "add_inspiration":
      return { label: "saving to Inspiration", run: async () => void (await send("delete_inspiration", { id: r.id })) };
    case "create_sop":
      return { label: `adding SOP ${quote(r.title)}`, run: async () => void (await send("delete_sop", { id: r.id })) };
    case "create_project":
      return { label: `adding project ${quote(r.name)}`, run: async () => void (await send("delete_project", { id: r.id })) };
    case "copy_artifact_to_note":
      return { label: "copying to a note", run: async () => void (await send("delete_note", { id: r.id })) };
    case "restore_from_trash": {
      const { type, id } = input as { type: "task" | "note" | "artifact" | "project" | "sop" | "routine" | "entry" | "inspiration"; id: string };
      const del = (
        {
          task: "delete_task",
          note: "delete_note",
          artifact: "delete_artifact",
          project: "delete_project",
          sop: "delete_sop",
          routine: "delete_routine",
          entry: "delete_archive_entry",
          inspiration: "delete_inspiration",
        } as const
      )[type];
      return { label: `bringing back a ${type}`, run: async () => void (await send(del, { id })) };
    }
    case "add_comment":
      return { label: "adding a comment", run: async () => void (await send("delete_comment", { id: r.id })) };
    case "reply_to_comment": {
      const reply = (result as Output<"reply_to_comment">).replies.at(-1);
      return reply ? { label: "replying", run: async () => void (await send("delete_comment", { id: reply.id })) } : null;
    }
    case "resolve_mention": {
      const resolved = input.resolved !== false;
      return {
        label: resolved ? "marking an @claude request done" : "reopening an @claude request",
        run: async () => void (await send("resolve_mention", { id: input.id as string, resolved: !resolved })),
      };
    }
    case "resolve_comment": {
      const resolved = input.resolved !== false;
      return {
        label: resolved ? "resolving a comment" : "reopening a comment",
        run: async () => void (await send("resolve_comment", { id: r.id, resolved: !resolved })),
      };
    }
  }
  if (!before?.length) return null;
  switch (name) {
    case "update_task":
    case "move_task": {
      const t = before[0] as TaskSnapshot;
      const verb = name === "move_task" ? "moving" : input.status && Object.keys(input).length === 2 ? "marking" : "editing";
      return { label: `${verb} ${quote(t.title)}`, run: async () => void (await send("update_task", taskFields(t))) };
    }
    case "update_tasks":
    case "move_tasks": {
      const tasks = before as TaskSnapshot[];
      return {
        label: `changing ${plural(tasks.length, "task")}`,
        run: async () => void (await Promise.all(tasks.map((t) => send("update_task", taskFields(t))))),
      };
    }
    case "update_notes": {
      const notes = before as Output<"get_note">[];
      return {
        label: `changing ${plural(notes.length, "note")}`,
        run: async () =>
          void (await Promise.all(
            notes.map((n) => send("update_note", { id: n.id, projectId: n.project?.id ?? null, folderId: n.folder?.id ?? null, pinned: n.pinned })),
          )),
      };
    }
    case "update_artifact": {
      const a = before[0] as Output<"get_artifact">;
      return {
        label: `editing ${quote(a.title)}`,
        run: async () => void (await send("update_artifact", { id: a.id, title: a.title, projectId: a.project?.id ?? null })),
      };
    }
    case "update_artifacts": {
      const list = before as Output<"get_artifact">[];
      return {
        label: `moving ${plural(list.length, "artifact")}`,
        run: async () =>
          void (await Promise.all(list.map((a) => send("update_artifact", { id: a.id, projectId: a.project?.id ?? null })))),
      };
    }
    case "update_project": {
      const p = before[0] as Output<"get_project">;
      return {
        label: `editing project ${quote(p.name)}`,
        run: async () => void (await send("update_project", { id: p.id, name: p.name, color: p.color })),
      };
    }
    default:
      return null;
  }
}
