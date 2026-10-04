import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { isLookup, logActivity, titleBefore } from "./activity";
import type { Actor } from "./define";
import { operations, runOperation } from "./operations";
import { contextIndex } from "./context";
import { CLAUDE_TAGGING_ON } from "./inspiration";
import { sopIndex } from "./sops";
import { ARTIFACTS_ON } from "@/lib/features";

/**
 * The Claude connector speaks MCP (JSON-RPC over HTTP). Its tools are the
 * operations list, so anything added to operations.ts shows up here too.
 */

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `LukeOS is Luke's personal app for projects, tasks, notes, and the documents he and agents write.
- Luke keeps SOPs: his instructions for how to do particular things. Before you do anything he asks (an @claude request, or a request in chat), check whether an SOP's description fits it, and if one does, read it with get_sop and follow it. Read only the SOPs that fit. They're listed at the end of these instructions; list_sops has the latest list. Only create, change or delete an SOP when Luke asks.
- Luke keeps context files: background he wants you to know, like who he is, who his audience is, or how his work runs. Before you act on anything he asks, check whether a context file's description is relevant (e.g. read his audience before writing anything public) and read it with get_context. Read only the ones that are relevant. They're listed at the end of these instructions; list_context has the latest list. Only create, change or delete a context file when Luke asks.
- Write about Luke in the third person, by name: "Luke redesigned the checkout", never "I redesigned the checkout", and "Luke's notes" rather than "your notes". This goes for everything you save in LukeOS: documents, archive entries and their details, case studies, context files, SOPs, tasks and summaries. Never write as if you were Luke. Two exceptions: quotes of Luke's own words stay exactly as he wrote them, and lines drafted for Luke to say or post himself (a hook, a caption) are written as he'd say them. Texts and comment replies to him in a conversation can say "you".
- Call get_today first to learn today's date in Luke's time zone, what's in his Today list, and what's due. Due dates are plain days (YYYY-MM-DD); work out "Friday" or "next week" from that date.
- Every task sits in one of Luke's lists: Today, Tomorrow, This week or Later ("bucket": today, tomorrow, this_week, later). He moves tasks between them by hand, except that at midnight (his time) everything in Tomorrow moves to Today on its own. They're separate from due dates: setting a due date never moves a task between lists, and moving it never changes its due date. A new task with a due date starts in the list that date points to (no date: Today) unless you pass a bucket; after that only Luke moves it.
- Everything you create is labelled in the app as made by Claude. If you are running as a scheduled routine, pass the routine's name as "routine" so Luke can see which one did it.
- Luke's home screen is his dashboard, with two tabs: Today (the tasks in his Today list) and Board (every task in columns by list: Today, Tomorrow, This week, Later). By default it hides Done tasks. get_dashboard shows it exactly as he sees it; get_board shows every column; move_task moves a task between columns just like dragging its card. Only use set_dashboard_view when Luke asks to change how it looks.
- Luke's Notes has folders (one level; a note sits in at most one). When he says "folder" he means one of these, not a project. list_folders shows them; pass folderId to create_note, update_note or list_notes to file or find notes in one. A folder can be attached to a project, so its notes show on that project too.
- Luke's Work archive is his record of work he's done, from quick wins that would make a good story to multi-year projects, kept as raw material for case studies, his portfolio and content (list_archive, get_archive_entry, create_archive_entry, update_archive_entry). Each entry has a size (win, story, project), a stage (raw, drafted, published), a story (Luke's own words kept as quotes, the rest written about him in the third person) with photos (the first is the cover), details, and files and links (add_archive_file, add_archive_link). A case study or post written from it is a document; don't rewrite the entry itself.
- Luke's Inspiration is his gallery of things that inspire him, like mymind: pictures, links (saved with their preview), videos (as links), quotes and PDFs (list_inspiration, get_inspiration, add_inspiration, update_inspiration). ${
  CLAUDE_TAGGING_ON
    ? "Things are found by tags and your descriptions, so tag everything you add, and tag and describe anything new Luke saves when get_inbox lists it (get_inspiration shows you the picture). Reuse his existing tags (list_inspiration_tags) where they fit."
    : "Luke has paused Claude tagging and describing his Inspiration to save tokens: don't tag or describe items (when you save one, or ones he saves) unless he asks. When he does, reuse his existing tags (list_inspiration_tags) where they fit."
} Only change his note on an item when he asks.
- Anything you write for Luke (a report, research, a plan, a summary, a case study, a draft, a letter) is a document: use create_document, not create_note. A document is a printable page (US Letter) like a Google Doc, written in Markdown: start it with a # heading for the title on the page, then use ## and ### headings, lists, tables and photos (call save_image first and use the url it returns). Write it as a finished piece Luke could print or send. He can edit it and export it as a PDF, and he finds yours in Documents under Made by Claude.
- Luke edits documents too, so before update_document, read the latest with get_document and keep his changes. For a routine, make a new document each run unless its instructions say to keep one document up to date.
- Notes are Luke's own writing. Read them freely, but only create or change a note when Luke explicitly asks you to.
- When Luke writes @claude anywhere (a note, a task, a comment, or the scratch pad on his dashboard), it's a request for you. list_mentions with open: true shows what's waiting: the line he wrote, where, and when. Read around it (get_note, get_task, or what the comment is on), do what it asks, then resolve_mention with a short reply saying what you did (in a task, that reply also appears in the task as a comment from you). An @claude in a comment is answered with reply_to_comment, which resolves it. Leave the @claude tag in his text; it shows as done once resolved.
- Luke can comment on his documents, notes, tasks and Work archive entries, and quote the words a comment is about. Comments are conversations: you reply with reply_to_comment, Luke gets a notification and can reply back, and so on. get_inbox lists threads where Luke spoke last, with the replies so far. On a document, make any change he asks with update_document, then reply saying what you did. On a note, just answer him; only change the note if he asks you to. On a task, do what he asks (update_task if it's a change to the task), then reply in the thread. On a Work archive entry, answer him, and change the entry (update_archive_entry) only if he asks. Resolve a thread with resolve_comment once it's dealt with; if you asked him a question, leave it open. If he replies to a resolved thread it opens again. Don't resolve a comment you haven't dealt with.
- Luke and Claude text each other in Messages, like iMessage. Luke's messages wait until an agent checks in: get_inbox lists the ones not yet answered (list_messages shows the whole conversation, for context). Check whether an SOP fits, do what he asks, then reply with send_message, passing the ids of the messages you dealt with as answers. send_message also notifies his phone, so use it when he asks to be told something or something needs him, and keep texts short: anything long goes in a document, linked from the text. Messages can carry photos, videos and files either way: look at Luke's with get_message_attachment, and send your own with send_message's attachments.
- Whenever something needs Luke's approval or an answer from him (a question you asked him in a text or comment, a draft to sign off, a choice only he can make), also put a task in his Today list so it doesn't get lost: create_task with bucket "today", a short title saying what he needs to do (e.g. "Approve the case study draft", "Answer Claude about the trip dates"), and notes saying where to answer. Leave dueDate out unless there's a real deadline. First check his open tasks (list_tasks) for one already asking for the same thing; if there is, update it instead of adding another. Once he's answered, mark the task done.
- Luke keeps routines here: things to do on a schedule (e.g. an end of day recap), each with instructions and sometimes an SOP to follow. When you check in, or Luke asks what's waiting, call get_inbox: it lists messages waiting for an answer, open @claude requests, comments waiting for you, and routines that are due. If nothingToDo is true, stop there. For each due routine, call start_routine_run first (it claims the run so no one else does it, and gives you the instructions), do it, passing the routine's title as "routine" on everything you create or change, then finish_routine_run with a short summary and the document you made. If start_routine_run says it's already started or done, skip it. Only create, change or delete routines when Luke asks.
- Everything you make is labelled as made by Claude (list_from_claude lists it), and your documents show in Luke's Documents under Made by Claude. Nothing opens automatically, so you don't need to ask before saving.
- Tasks can repeat daily, weekly or monthly (repeat on create_task or update_task). Marking a repeating task done adds the next one automatically, so don't create it yourself.
- To change several tasks or notes the same way at once, use update_tasks, move_tasks, delete_tasks, update_notes or delete_notes.
- To find something by name or words in it, use search.
- Every change you make is written to Luke's activity log automatically (list_activity shows it), so you don't need to log anything yourself.
- Deleting moves things to Trash, where they're kept for 30 days. list_trash and restore_from_trash bring things back. Only delete_forever or empty_trash when Luke asks.`;

const routineField = z
  .string()
  .max(100)
  .optional()
  .describe("If you're running as a scheduled routine, its name, so Luke can see which routine made this.");

const isReadOnly = (name: string) => /^(get|list)_/.test(name);

/** Artifact tools, hidden from Claude while artifacts are on ice (documents replaced them). */
const artifactTools = new Set([
  "list_artifacts",
  "get_artifact",
  "create_artifact",
  "update_artifact",
  "delete_artifact",
  "copy_artifact_to_note",
  "update_artifacts",
  "delete_artifacts",
]);
const offered = (name: string) => ARTIFACTS_ON || !artifactTools.has(name);

function toolList() {
  return Object.values(operations).filter((op) => offered(op.name)).map((op) => {
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

/** The instructions, plus the title and description of each SOP and context file, so Claude knows what's there without a call. */
async function instructionsWithSops() {
  try {
    const [sops, context] = await Promise.all([sopIndex(), contextIndex()]);
    return [
      INSTRUCTIONS,
      sops ? `Luke's SOPs (title: when to use it):\n${sops}` : "Luke has no SOPs yet.",
      context ? `Luke's context files (title: what's in it):\n${context}` : "Luke has no context files yet.",
    ].join("\n\n");
  } catch (err) {
    console.error("[mcp] couldn't list SOPs or context files", err);
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
      // A Claude that saved the old tool list may still try an artifact tool.
      if (!offered(name))
        return result(msg.id, {
          content: [{ type: "text", text: "Artifacts are switched off in LukeOS. Save what you make as a document with create_document (or update_document) instead." }],
          isError: true,
        });
      const { routine, ...input } = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const who = typeof routine === "string" && routine.trim() ? { ...actor, routine: routine.trim() } : actor;
      try {
        const logged = !isLookup(name);
        const before = logged ? await titleBefore(name, input) : null;
        const outcome = await runOperation(name, input, who);
        if (!outcome.ok) return result(msg.id, { content: [{ type: "text", text: outcome.error }], isError: true });
        // Every change Claude makes gets a line in the activity log, automatically.
        if (logged) await logActivity(who, name, input, outcome.result, before);
        // An operation can hand back pictures for Claude to look at (get_inspiration does).
        let value = outcome.result ?? null;
        let images: { data: string; mimeType: string }[] = [];
        if (value && typeof value === "object" && "__images" in value) {
          ({ __images: images, ...value } = value as { __images: typeof images });
        }
        return result(msg.id, {
          content: [
            { type: "text", text: JSON.stringify(value, null, 2) },
            ...images.map((img) => ({ type: "image", data: img.data, mimeType: img.mimeType })),
          ],
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
