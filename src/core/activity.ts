import "server-only";
import { desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { statusLabel, type Status } from "@/lib/task-fields";
import { defineOperation, type Actor } from "./define";
import { inspirationLabel } from "./inspiration";

const { activityLog, tasks, notes, artifacts, documents, cards, projects, sops, contextFiles, routines, archiveEntries, inspirationItems } = schema;

type ItemType = "task" | "note" | "artifact" | "document" | "card" | "project" | "sop" | "context" | "routine" | "entry" | "inspiration";

/** One line of the activity log. */
export type ActivityEntry = {
  id: string;
  at: Date;
  name: string;
  routine: string | null;
  tool: string;
  summary: string;
  item: { type: ItemType; id: string } | null;
};

/** Tools that only look at things. They aren't logged, or the log would fill up with lookups. */
export const isLookup = (tool: string) => /^(get|list)_/.test(tool) || tool === "search";

const columnLabel: Record<string, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  this_week: "This week",
  this_month: "This month",
  later: "Later",
};

const fieldLabel: Record<string, string> = {
  title: "title",
  projectId: "project",
  status: "status",
  bucket: "list",
  dueDate: "due date",
  priority: "priority",
  effort: "effort",
  repeat: "repeat",
  notes: "notes",
  content: "text",
  name: "name",
  color: "colour",
  description: "description",
  body: "instructions",
  instructions: "instructions",
  frequency: "schedule",
  time: "time",
  days: "days",
  dayOfMonth: "day of the month",
  sopId: "SOP",
  enabled: "on",
  pinned: "pin",
  story: "story",
  size: "size",
  stage: "stage",
  company: "company",
  role: "role",
  period: "when",
  outcome: "outcome",
  confidential: "confidential",
};

const quote = (title: string | null | undefined) => {
  const t = (title ?? "").trim() || "Untitled";
  return `“${t.length > 60 ? `${t.slice(0, 59)}…` : t}”`;
};

const kindLabel = (type: ItemType) =>
  type === "sop" ? "SOP" : type === "context" ? "context file" : type === "entry" ? "Work archive entry" : type === "inspiration" ? "Inspiration item" : type;

const changed = (input: Record<string, unknown>) =>
  Object.keys(input)
    .filter((k) => k !== "id" && input[k] !== undefined && fieldLabel[k])
    .map((k) => fieldLabel[k]);

async function titleOf(type: ItemType, id: unknown) {
  if (typeof id !== "string") return null;
  try {
    if (type === "project") {
      const [row] = await db.select({ t: projects.name }).from(projects).where(eq(projects.id, id)).limit(1);
      return row?.t ?? null;
    }
    if (type === "inspiration") {
      const [row] = await db
        .select({ title: inspirationItems.title, kind: inspirationItems.kind, body: inspirationItems.body, fileName: inspirationItems.fileName })
        .from(inspirationItems)
        .where(eq(inspirationItems.id, id))
        .limit(1);
      return row ? inspirationLabel(row) : null;
    }
    const table =
      type === "task"
        ? tasks
        : type === "card"
          ? cards
        : type === "document"
          ? documents
        : type === "note"
          ? notes
          : type === "sop"
            ? sops
            : type === "context"
              ? contextFiles
            : type === "routine"
              ? routines
              : type === "entry"
                ? archiveEntries
                : artifacts;
    const [row] = await db.select({ t: table.title }).from(table).where(eq(table.id, id)).limit(1);
    return row?.t ?? null;
  } catch {
    return null;
  }
}

/**
 * Some tools only return an id (deletes, Trash), so the thing's name has to be
 * read before it runs, while it still exists.
 */
export async function titleBefore(tool: string, input: Record<string, unknown>) {
  switch (tool) {
    case "delete_task":
      return titleOf("task", input.id);
    case "delete_note":
      return titleOf("note", input.id);
    case "delete_document":
      return titleOf("document", input.id);
    case "delete_card":
      return titleOf("card", input.id);
    case "attach_to_card":
    case "detach_from_card":
      return titleOf("card", input.cardId);
    case "delete_project":
      return titleOf("project", input.id);
    case "delete_artifact":
      return titleOf("artifact", input.id);
    case "delete_sop":
      return titleOf("sop", input.id);
    case "delete_context":
      return titleOf("context", input.id);
    case "delete_routine":
      return titleOf("routine", input.id);
    case "delete_archive_entry":
      return titleOf("entry", input.id);
    case "add_archive_link":
    case "add_archive_file":
      return titleOf("entry", input.entryId);
    case "update_inspiration":
    case "delete_inspiration":
      return titleOf("inspiration", input.id);
    case "restore_from_trash":
    case "delete_forever":
      return titleOf(input.type as ItemType, input.id);
    default:
      return null;
  }
}

type Described = { summary: string; item?: { type: ItemType; id: string } } | null;

type Named = { id: string; title?: string; name?: string; format?: string; project?: { name: string } | null };

/** A very short line saying what a tool call did, e.g. Moved task “Call Mum” to This week. */
export function describe(tool: string, input: Record<string, unknown>, result: unknown, before: string | null): Described {
  const r = (result ?? {}) as Record<string, unknown>;
  const task = r as unknown as Named;
  const inProject = (x: Named) => (x.project?.name ? ` in ${x.project.name}` : "");

  switch (tool) {
    case "create_task":
      return { summary: `Added task ${quote(task.title)}${inProject(task)}`, item: { type: "task", id: task.id } };
    case "update_task": {
      const fields = changed(input);
      const onlyStatus = fields.length === 1 && fields[0] === "status";
      const summary = onlyStatus
        ? `Marked task ${quote(task.title)} as ${statusLabel[input.status as Status] ?? input.status}`
        : `Edited task ${quote(task.title)}${fields.length ? ` (${fields.join(", ")})` : ""}`;
      return { summary, item: { type: "task", id: task.id } };
    }
    case "move_task": {
      if (!r.moved) return null;
      const t = r.task as Named;
      const to = String(input.to);
      const where = columnLabel[to] ?? statusLabel[to as Status] ?? to;
      return { summary: `Moved task ${quote(t.title)} to ${where}`, item: { type: "task", id: t.id } };
    }
    case "delete_task":
      return { summary: `Moved task ${quote(before)} to Trash`, item: { type: "task", id: String(input.id) } };

    case "create_project":
      return { summary: `Created project ${quote(task.name)}`, item: { type: "project", id: task.id } };
    case "update_project": {
      const fields = changed(input);
      const summary =
        fields.length === 1 && fields[0] === "name"
          ? `Renamed project to ${quote(task.name)}`
          : `Edited project ${quote(task.name)}${fields.length ? ` (${fields.join(", ")})` : ""}`;
      return { summary, item: { type: "project", id: task.id } };
    }
    case "delete_project":
      return { summary: `Moved project ${quote(before)} to Trash`, item: { type: "project", id: String(input.id) } };

    case "create_note":
      return {
        summary: `${task.format === "html" ? "Saved page" : "Wrote note"} ${quote(task.title)}${inProject(task)}`,
        item: { type: "note", id: task.id },
      };
    case "update_note": {
      const fields = changed(input);
      const summary =
        typeof input.append === "string" && input.append.trim() && fields.length === 0
          ? `Added to note ${quote(task.title)}`
          : fields.length === 1 && fields[0] === "pin"
            ? `${input.pinned ? "Pinned" : "Unpinned"} note ${quote(task.title)}`
            : `Edited note ${quote(task.title)}${fields.length ? ` (${fields.join(", ")})` : ""}`;
      return { summary, item: { type: "note", id: task.id } };
    }
    case "create_document":
      return { summary: `Wrote document ${quote(task.title)}${inProject(task)}`, item: { type: "document", id: task.id } };
    case "update_document": {
      const fields = changed(input);
      const summary =
        typeof input.append === "string" && input.append.trim() && fields.length === 0
          ? `Added to document ${quote(task.title)}`
          : `Edited document ${quote(task.title)}${fields.length ? ` (${fields.join(", ")})` : ""}`;
      return { summary, item: { type: "document", id: task.id } };
    }
    case "set_up_pipeline":
    case "add_pipeline_column":
    case "update_pipeline_column":
    case "delete_pipeline_column": {
      const p = r as { project?: { id: string; name: string } };
      if (!p.project) return null;
      const what =
        tool === "set_up_pipeline"
          ? "Started a pipeline on"
          : tool === "add_pipeline_column"
            ? `Added column ${quote(String(input.name))} to the pipeline in`
            : tool === "update_pipeline_column"
              ? "Changed a pipeline column in"
              : "Deleted a pipeline column in";
      return { summary: `${what} ${quote(p.project.name)}`, item: { type: "project", id: p.project.id } };
    }
    case "create_card":
      return { summary: `Added card ${quote(task.title)}${inProject(task)}`, item: { type: "card", id: task.id } };
    case "update_card": {
      const fields = changed(input).concat(input.column !== undefined ? ["column"] : []);
      return { summary: `Edited card ${quote(task.title)}${fields.length ? ` (${fields.join(", ")})` : ""}`, item: { type: "card", id: task.id } };
    }
    case "move_card": {
      if (!r.moved) return null;
      const c = r.card as Named & { column?: { name: string } | null };
      return { summary: `Moved card ${quote(c.title)} to ${c.column?.name ?? String(input.to)}`, item: { type: "card", id: c.id } };
    }
    case "delete_card":
      return { summary: `Moved card ${quote(before)} to Trash`, item: { type: "card", id: String(input.id) } };
    case "approve_card": {
      const c = r as Named & { column?: { name: string } | null };
      return { summary: `Approved idea ${quote(c.title)}, moved to ${c.column?.name ?? "the next column"}`, item: { type: "card", id: c.id } };
    }
    case "reject_card":
      return { summary: `Rejected idea ${quote(String(r.title))}` };
    case "unreject_card":
      return { summary: `Brought back rejected idea ${quote(task.title)}`, item: { type: "card", id: task.id } };
    case "attach_to_card":
    case "detach_from_card": {
      const kind = { task: "a task", document: "a document", note: "a note", inspiration: "an Inspiration item", entry: "a Work archive entry" }[String(input.type)] ?? "something";
      return {
        summary: tool === "attach_to_card" ? `Attached ${kind} to card ${quote(before)}` : `Took ${kind} off card ${quote(before)}`,
        item: { type: "card", id: String(input.cardId) },
      };
    }
    case "delete_document":
      return { summary: `Moved document ${quote(before)} to Trash`, item: { type: "document", id: String(input.id) } };
    case "delete_note":
      return { summary: `Moved note ${quote(before)} to Trash`, item: { type: "note", id: String(input.id) } };
    case "create_artifact": {
      const a = r as unknown as Named & { parts?: number };
      return { summary: `Made ${a.format === "html" ? "page" : "artifact"} ${quote(a.title)}${inProject(a)}`, item: { type: "artifact", id: a.id } };
    }
    case "update_artifact": {
      const a = r as unknown as Named & { version: number; shown?: { note: string | null } };
      const newVersion = input.content !== undefined || input.parts !== undefined;
      const fields = changed(input).filter((f) => f !== "text");
      const summary = newVersion
        ? `Updated artifact ${quote(a.title)} to version ${a.version}${a.shown?.note ? ` (${a.shown.note.slice(0, 80)})` : ""}`
        : `Edited artifact ${quote(a.title)}${fields.length ? ` (${fields.join(", ")})` : ""}`;
      return { summary, item: { type: "artifact", id: a.id } };
    }
    case "delete_artifact":
      return { summary: `Moved artifact ${quote(before)} to Trash`, item: { type: "artifact", id: String(input.id) } };
    case "create_sop":
      return { summary: `Added SOP ${quote(task.title)}`, item: { type: "sop", id: task.id } };
    case "update_sop": {
      const fields = changed(input);
      return { summary: `Edited SOP ${quote(task.title)}${fields.length ? ` (${fields.join(", ")})` : ""}`, item: { type: "sop", id: task.id } };
    }
    case "delete_sop":
      return { summary: `Moved SOP ${quote(before)} to Trash`, item: { type: "sop", id: String(input.id) } };
    case "create_context":
      return { summary: `Added context file ${quote(task.title)}`, item: { type: "context", id: task.id } };
    case "update_context": {
      const fields = changed(input).map((f) => (f === "instructions" ? "text" : f));
      return {
        summary: `Edited context file ${quote(task.title)}${fields.length ? ` (${fields.join(", ")})` : ""}`,
        item: { type: "context", id: task.id },
      };
    }
    case "delete_context":
      return { summary: `Moved context file ${quote(before)} to Trash`, item: { type: "context", id: String(input.id) } };
    case "create_routine":
      return { summary: `Added routine ${quote(task.title)}`, item: { type: "routine", id: task.id } };
    case "update_routine": {
      const fields = changed(input);
      const onOff = fields.length === 1 && fields[0] === "on";
      const summary = onOff
        ? `Turned routine ${quote(task.title)} ${input.enabled ? "on" : "off"}`
        : `Edited routine ${quote(task.title)}${fields.length ? ` (${fields.join(", ")})` : ""}`;
      return { summary, item: { type: "routine", id: task.id } };
    }
    case "delete_routine":
      return { summary: `Moved routine ${quote(before)} to Trash`, item: { type: "routine", id: String(input.id) } };
    case "start_routine_run": {
      const run = r as { routine?: { id: string; title: string } };
      if (!run.routine) return null;
      return { summary: `Started routine ${quote(run.routine.title)}`, item: { type: "routine", id: run.routine.id } };
    }
    case "finish_routine_run": {
      const run = r as { routine?: { id: string; title: string } | null; status?: string };
      if (!run.routine) return null;
      const verb = run.status === "failed" ? "Couldn't finish" : "Finished";
      return { summary: `${verb} routine ${quote(run.routine.title)}`, item: { type: "routine", id: run.routine.id } };
    }
    case "create_archive_entry":
      return { summary: `Added ${quote(task.title)} to the Work archive`, item: { type: "entry", id: task.id } };
    case "update_archive_entry": {
      const fields = changed(input);
      const summary =
        typeof input.append === "string" && input.append.trim() && fields.length === 0
          ? `Added to ${quote(task.title)} in the Work archive`
          : `Edited ${quote(task.title)} in the Work archive${fields.length ? ` (${fields.join(", ")})` : ""}`;
      return { summary, item: { type: "entry", id: task.id } };
    }
    case "delete_archive_entry":
      return { summary: `Moved ${quote(before)} from the Work archive to Trash`, item: { type: "entry", id: String(input.id) } };
    case "add_archive_link":
    case "add_archive_file":
      return {
        summary: `Added ${tool === "add_archive_link" ? "a link" : "a file"} ${quote((r as { name?: string }).name)} to ${quote(before)}`,
        item: { type: "entry", id: String(input.entryId) },
      };
    case "remove_archive_file": {
      const f = r as { name?: string; entryId?: string };
      return { summary: `Removed ${quote(f.name)} from a Work archive entry`, item: f.entryId ? { type: "entry", id: f.entryId } : undefined };
    }
    case "add_inspiration": {
      const i = r as { id: string; title?: string; kind?: string };
      return { summary: `Saved ${i.title ? quote(i.title) : `a ${i.kind === "text" ? "quote" : (i.kind ?? "thing")}`} to Inspiration`, item: { type: "inspiration", id: i.id } };
    }
    case "update_inspiration": {
      const i = r as { id: string; title?: string; tags?: string[] };
      const name = quote(i.title || before);
      const tagging = (input.tags !== undefined || input.addTags !== undefined || input.summary !== undefined) && !input.title && !input.note;
      return {
        summary: tagging ? `Tagged ${name} in Inspiration${i.tags?.length ? ` (${i.tags.slice(0, 5).join(", ")})` : ""}` : `Edited ${name} in Inspiration`,
        item: { type: "inspiration", id: i.id },
      };
    }
    case "update_inspirations": {
      const n = ((r.updated as unknown[]) ?? []).length;
      return { summary: `Tagged ${n} ${n === 1 ? "thing" : "things"} in Inspiration` };
    }
    case "delete_inspiration":
      return { summary: `Moved ${quote(before)} from Inspiration to Trash`, item: { type: "inspiration", id: String(input.id) } };
    case "set_check_in_times":
      return { summary: `Changed check-in times to ${String((r as { checkIns?: string }).checkIns ?? "")}` };
    case "copy_artifact_to_note":
      return { summary: `Copied an artifact into note ${quote(task.title)}`, item: { type: "note", id: task.id } };
    case "add_comment":
    case "reply_to_comment":
    case "resolve_comment": {
      const c = r as { target?: { type: "note" | "artifact" | "document" | "task" | "entry" | "card"; id: string; title: string } };
      if (!c.target) return null;
      const on = `${kindLabel(c.target.type)} ${quote(c.target.title)}`;
      const summary =
        tool === "add_comment"
          ? `Commented on ${on}`
          : tool === "reply_to_comment"
            ? `Replied to a comment on ${on}`
            : input.resolved === false
              ? `Reopened a comment on ${on}`
              : `Resolved a comment on ${on}`;
      return { summary, item: { type: c.target.type, id: c.target.id } };
    }
    case "delete_comment":
      return { summary: "Deleted a comment" };
    case "resolve_mention": {
      const m = r as {
        where?: { type: string; id: string; title: string; on: { type: "note" | "artifact" | "document" | "task" | "entry" | "card"; id: string; title: string } | null };
      };
      if (!m.where) return null;
      const verb = input.resolved === false ? "Reopened" : "Dealt with";
      const on = m.where.on ? `a comment on ${quote(m.where.on.title)}` : `${m.where.type} ${quote(m.where.title)}`;
      const item =
        m.where.on ? { type: m.where.on.type, id: m.where.on.id } : m.where.type === "comment" ? undefined : { type: m.where.type as "note" | "task", id: m.where.id };
      return { summary: `${verb} an @claude request in ${on}`, item };
    }
    case "save_image":
      return { summary: input.alt ? `Saved a photo (${String(input.alt).slice(0, 60)})` : "Saved a photo" };

    case "restore_from_trash": {
      const type = input.type as ItemType;
      return { summary: `Brought back ${kindLabel(type)} ${quote(before)} from Trash`, item: { type, id: String(input.id) } };
    }
    case "delete_forever":
      return { summary: `Deleted ${kindLabel(input.type as ItemType)} ${quote(before)} forever` };
    case "empty_trash": {
      const c = (r.deletedForever ?? {}) as Record<string, number>;
      const n = (c.tasks ?? 0) + (c.notes ?? 0) + (c.artifacts ?? 0) + (c.documents ?? 0) + (c.cards ?? 0) + (c.projects ?? 0) + (c.sops ?? 0) + (c.context ?? 0) + (c.routines ?? 0) + (c.entries ?? 0) + (c.inspiration ?? 0);
      return { summary: `Emptied Trash (${n} ${n === 1 ? "item" : "items"})` };
    }

    case "mark_from_claude_seen":
      return { summary: "Cleared the New markers in Agents" };
    case "set_time_zone":
      return { summary: `Set your time zone to ${input.timeZone}` };
    case "update_tasks":
    case "move_tasks":
    case "delete_tasks":
    case "update_notes":
    case "delete_notes":
    case "update_artifacts":
    case "delete_artifacts": {
      const out = r as { count?: number; titles?: string[]; project?: string | null };
      const n = out.count ?? 0;
      if (n === 0) return null;
      const kind = tool.endsWith("tasks") ? "task" : tool.endsWith("notes") ? "note" : "artifact";
      const things = `${n} ${kind}${n === 1 ? "" : "s"}`;
      const names = (out.titles ?? []).slice(0, 3).map(quote).join(", ") + (n > 3 ? ", …" : "");
      let action: string;
      if (tool.startsWith("delete_")) action = `Moved ${things} to Trash`;
      else if (tool === "move_tasks") {
        const to = String(input.to);
        action = `Moved ${things} to ${columnLabel[to] ?? statusLabel[to as Status] ?? to}`;
      } else {
        const fields = changed(input);
        action =
          fields.length === 1 && fields[0] === "project"
            ? out.project
              ? `Moved ${things} to ${out.project}`
              : `Took ${things} out of their project`
            : fields.length === 1 && fields[0] === "pin"
              ? `${input.pinned ? "Pinned" : "Unpinned"} ${things}`
              : fields.length === 1 && fields[0] === "status"
              ? `Marked ${things} as ${statusLabel[input.status as Status] ?? input.status}`
              : `Edited ${things} (${fields.join(", ")})`;
      }
      return { summary: `${action}: ${names}` };
    }
    case "send_message": {
      const text = String(input.text ?? "").replace(/\s+/g, " ").trim();
      const n = Array.isArray(input.attachments) ? input.attachments.length : 0;
      const files = n ? `${n} ${n === 1 ? "attachment" : "attachments"}` : "";
      return { summary: text ? `Sent you a message: ${quote(text)}${files ? ` (with ${files})` : ""}` : `Sent you ${files}` };
    }
    case "edit_message":
      return { summary: `Edited a message to you: ${quote(String(input.text ?? "").replace(/\s+/g, " ").trim())}` };
    case "unsend_message":
      return { summary: "Unsent a message to you" };
    case "mark_messages_read":
      return null;
    case "log_focus_session": {
      const minutes = Math.round(Number(input.seconds ?? 0) / 60);
      const label = typeof input.label === "string" && input.label.trim() ? ` on ${quote(input.label.trim())}` : "";
      return { summary: `Logged ${minutes} min of focus${label}` };
    }
    case "update_focus_settings":
      return { summary: "Changed your pomodoro lengths" };
    case "set_dashboard_view":
      return { summary: "Changed how your dashboard looks" };
    default:
      return { summary: `Used ${tool.replace(/_/g, " ")}` };
  }
}

/** Writes one line to the log. Never fails the tool call it's describing. */
export async function logActivity(
  actor: Actor & { kind: "agent" },
  tool: string,
  input: Record<string, unknown>,
  result: unknown,
  before: string | null,
) {
  try {
    const line = describe(tool, input, result, before);
    if (!line) return;
    await db.insert(activityLog).values({
      agentName: actor.name,
      routine: actor.routine ?? null,
      tool,
      summary: line.summary,
      itemType: line.item?.type ?? null,
      itemId: line.item?.id ?? null,
    });
  } catch (err) {
    console.error(`[activity] couldn't log ${tool}`, err);
  }
}

/** The log, newest first. */
export async function listActivity(filter: { limit?: number; before?: Date } = {}): Promise<ActivityEntry[]> {
  const rows = await db
    .select()
    .from(activityLog)
    .where(filter.before ? lt(activityLog.at, filter.before) : undefined)
    .orderBy(desc(activityLog.at))
    .limit(filter.limit ?? 100);
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    name: row.agentName,
    routine: row.routine,
    tool: row.tool,
    summary: row.summary,
    item: row.itemType && row.itemId ? { type: row.itemType as ItemType, id: row.itemId } : null,
  }));
}

export const activityOperations = {
  list_activity: defineOperation({
    name: "list_activity",
    description:
      "The activity log: a short line for each change Claude has made in LukeOS through this connector (adding, editing, moving, deleting), with the time, newest first. Lookups aren't logged.",
    input: z.object({ limit: z.number().int().min(1).max(200).optional() }),
    run: async ({ limit }) => listActivity({ limit }),
  }),
};
