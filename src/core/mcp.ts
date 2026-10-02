import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { isLookup, logActivity, titleBefore } from "./activity";
import type { Actor } from "./define";
import { operations, runOperation } from "./operations";
import { sopIndex } from "./sops";

/**
 * The Claude connector speaks MCP (JSON-RPC over HTTP). Its tools are the
 * operations list, so anything added to operations.ts shows up here too.
 */

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `LukeOS is Luke's personal app for projects, tasks, notes and the artifacts agents make for him.
- Luke keeps SOPs: his instructions for how to do particular things. Before you do anything he asks (an @claude request, or a request in chat), check whether an SOP's description fits it, and if one does, read it with get_sop and follow it. Read only the SOPs that fit. They're listed at the end of these instructions; list_sops has the latest list. Only create, change or delete an SOP when Luke asks.
- Call get_today first to learn today's date in Luke's time zone, what's in his Today list, and what's due. Due dates are plain days (YYYY-MM-DD); work out "Friday" or "next week" from that date.
- Every task sits in one of Luke's lists: Today, Tomorrow, This week or Later ("bucket": today, tomorrow, this_week, later). He moves tasks between them by hand. They're separate from due dates: setting a due date never moves a task between lists, and moving it never changes its due date. A new task with a due date starts in the list that date points to (no date: Today) unless you pass a bucket; after that only Luke moves it.
- Everything you create is labelled in the app as made by Claude. If you are running as a scheduled routine, pass the routine's name as "routine" so Luke can see which one did it.
- Luke's home screen is his dashboard, with two tabs: Today (the tasks in his Today list) and Board (every task in columns by list: Today, Tomorrow, This week, Later). By default it hides Done tasks. get_dashboard shows it exactly as he sees it; get_board shows every column; move_task moves a task between columns just like dragging its card. Only use set_dashboard_view when Luke asks to change how it looks.
- Luke's Notes has folders (one level; a note sits in at most one). When he says "folder" he means one of these, not a project. list_folders shows them; pass folderId to create_note, update_note or list_notes to file or find notes in one. A folder can be attached to a project, so its notes show on that project too.
- Luke's Work archive is his record of work he's done, from quick wins that would make a good story to multi-year projects, kept as raw material for case studies, his portfolio and content (list_archive, get_archive_entry, create_archive_entry, update_archive_entry). Each entry has a size (win, story, project), a stage (raw, drafted, published), a story in his words with photos (the first is the cover), details, and files and links (add_archive_file, add_archive_link). A case study or post written from it is an artifact; don't rewrite the entry itself.
- Anything you write for Luke (a report, research, a plan, a web page, a summary) is an artifact: use create_artifact, not create_note. An artifact is one bundle: it can hold several parts (each shown as a tab, e.g. a report and its data) in Markdown or HTML, with photos inside them (call save_image first and use the url it returns). Luke reads artifacts; he doesn't edit them.
- Artifacts keep versions. update_artifact with new content adds a version and keeps the old ones, so say what changed in its note. For a routine, make a new artifact each run unless its instructions say to keep one artifact up to date.
- Notes are Luke's own writing. Read them freely, but only create or change a note when Luke explicitly asks you to.
- When Luke writes @claude anywhere (a note, a task, a comment, or the scratch pad on his dashboard), it's a request for you. list_mentions with open: true shows what's waiting: the line he wrote, where, and when. Read around it (get_note, get_task, or the comment's note or artifact), do what it asks, then resolve_mention with a short reply saying what you did. Leave the @claude tag in his text; it shows as done once resolved.
- Luke can comment on his notes and artifacts, and quote the words a comment is about. Comments are conversations: you reply with reply_to_comment, Luke gets a notification and can reply back, and so on. get_inbox lists threads where Luke spoke last, with the replies so far. On an artifact, make any change he asks with update_artifact, then reply saying what you did. On a note, just answer him; only change the note if he asks you to. Resolve a thread with resolve_comment once it's dealt with; if you asked him a question, leave it open. If he replies to a resolved thread it opens again. Don't resolve a comment you haven't dealt with.
- Luke and Claude text each other in Messages, like iMessage. Luke's messages wait until an agent checks in: get_inbox lists the ones not yet answered (list_messages shows the whole conversation, for context). Check whether an SOP fits, do what he asks, then reply with send_message, passing the ids of the messages you dealt with as answers. send_message also notifies his phone, so use it when he asks to be told something or something needs him, and keep texts short: anything long goes in an artifact, linked from the text.
- Luke keeps routines here: things to do on a schedule (e.g. an end of day recap), each with instructions and sometimes an SOP to follow. When you check in, or Luke asks what's waiting, call get_inbox: it lists messages waiting for an answer, open @claude requests, comments waiting for you, and routines that are due. If nothingToDo is true, stop there. For each due routine, call start_routine_run first (it claims the run so no one else does it, and gives you the instructions), do it, passing the routine's title as "routine" on everything you create or change, then finish_routine_run with a short summary and the artifact you made. If start_routine_run says it's already started or done, skip it. Only create, change or delete routines when Luke asks.
- Everything you make appears in Luke's Agents section (list_from_claude). Nothing opens automatically, so you don't need to ask before saving.
- Tasks can repeat daily, weekly or monthly (repeat on create_task or update_task). Marking a repeating task done adds the next one automatically, so don't create it yourself.
- To change several tasks, notes or artifacts the same way at once, use update_tasks, move_tasks, delete_tasks, update_notes, delete_notes, update_artifacts or delete_artifacts.
- To find something by name or words in it, use search.
- Every change you make is written to Luke's activity log automatically (list_activity shows it), so you don't need to log anything yourself.
- Deleting moves things to Trash, where they're kept for 30 days. list_trash and restore_from_trash bring things back. Only delete_forever or empty_trash when Luke asks.`;

const routineField = z
  .string()
  .max(100)
  .optional()
  .describe("If you're running as a scheduled routine, its name, so Luke can see which routine made this.");

const isReadOnly = (name: string) => /^(get|list)_/.test(name);

function toolList() {
  return Object.values(operations).map((op) => {
    const input = isReadOnly(op.name) ? op.input : (op.input as z.ZodObject).extend({ routine: routineField });
    const inputSchema = z.toJSONSchema(input, { io: "input", unrepresentable: "any" });
    delete inputSchema.$schema;
    return {
      name: op.name,
      description: op.description,
      inputSchema,
      annotations: {
        readOnlyHint: isReadOnly(op.name),
        destructiveHint: op.name.startsWith("delete_"),
        openWorldHint: false,
      },
    };
  });
}

/**
 * The server's version is a fingerprint of its tools, so it changes whenever a
 * tool is added or changed. Claude apps save the tool list; a new version tells
 * them to fetch it again rather than keep using an old one.
 */
let fingerprint: string | undefined;
function serverVersion() {
  fingerprint ??= createHash("sha256").update(JSON.stringify([INSTRUCTIONS, toolList()])).digest("hex").slice(0, 12);
  return `1.0.0+${fingerprint}`;
}

/** The instructions, plus the title and description of each SOP, so Claude knows what's there without a call. */
async function instructionsWithSops() {
  try {
    const index = await sopIndex();
    return index ? `${INSTRUCTIONS}\n\nLuke's SOPs (title: when to use it):\n${index}` : `${INSTRUCTIONS}\n\nLuke has no SOPs yet.`;
  } catch (err) {
    console.error("[mcp] couldn't list SOPs", err);
    return INSTRUCTIONS;
  }
}

type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const result = (id: Message["id"], value: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result: value });
const error = (id: Message["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

/** Handles one JSON-RPC message (or a batch). Returns null when there's nothing to answer. */
export async function handleMcp(body: unknown, actor: Actor & { kind: "agent" }): Promise<unknown> {
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handleOne(m, actor)))).filter((r) => r !== null);
    return replies.length ? replies : null;
  }
  return handleOne(body, actor);
}

async function handleOne(raw: unknown, actor: Actor & { kind: "agent" }) {
  if (!raw || typeof raw !== "object") return error(null, -32700, "Parse error");
  const msg = raw as Message;
  // Notifications (no id) and replies to us need no answer.
  if (msg.id === undefined || !msg.method) return null;

  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return result(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "lukeos", title: "LukeOS", version: serverVersion() },
        instructions: await instructionsWithSops(),
      });
    }
    case "ping":
      return result(msg.id, {});
    case "tools/list":
      return result(msg.id, { tools: toolList() });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      if (!Object.hasOwn(operations, name)) return error(msg.id, -32602, `Unknown tool "${name}".`);
      const { routine, ...input } = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const who = typeof routine === "string" && routine.trim() ? { ...actor, routine: routine.trim() } : actor;
      try {
        const logged = !isLookup(name);
        const before = logged ? await titleBefore(name, input) : null;
        const outcome = await runOperation(name, input, who);
        if (!outcome.ok) return result(msg.id, { content: [{ type: "text", text: outcome.error }], isError: true });
        // Every change Claude makes gets a line in the activity log, automatically.
        if (logged) await logActivity(who, name, input, outcome.result, before);
        return result(msg.id, {
          content: [{ type: "text", text: JSON.stringify(outcome.result ?? null, null, 2) }],
        });
      } catch (err) {
        console.error(`[mcp] ${name} failed`, err);
        return result(msg.id, {
          content: [{ type: "text", text: "Something went wrong in LukeOS. Try again in a moment." }],
          isError: true,
        });
      }
    }
    default:
      return error(msg.id, -32601, `Method "${msg.method}" isn't supported.`);
  }
}
