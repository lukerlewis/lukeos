import "server-only";
import { z } from "zod";
import { isLookup, logActivity, titleBefore } from "./activity";
import type { Actor } from "./define";
import { operations, runOperation } from "./operations";

/**
 * The Claude connector speaks MCP (JSON-RPC over HTTP). Its tools are the
 * operations list, so anything added to operations.ts shows up here too.
 */

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `LukeOS is Luke's personal app for projects, tasks and notes.
- Call get_today first to learn today's date in Luke's time zone and what's due. Due dates are plain days (YYYY-MM-DD); work out "Friday" or "next week" from that date.
- Everything you create is labelled in the app as made by Claude. If you are running as a scheduled routine, pass the routine's name as "routine" so Luke can see which one did it.
- Luke's board has columns by when (Today, This week, This month, Later) or by status (To do, Doing, Done). get_board shows it; move_task moves a card between columns just like dragging it.
- Notes are Markdown pages, inside a project or on their own. To file a document or report, use create_note (Markdown is best, since Luke can edit it). To save a finished artifact as a web page, use create_note with format "html". For a photo, call save_image first and put the Markdown it returns in the note.
- Everything you make appears in Luke's Agent log section (list_from_claude). Nothing opens automatically, so you don't need to ask before saving.
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
        serverInfo: { name: "lukeos", title: "LukeOS", version: "1.0.0" },
        instructions: INSTRUCTIONS,
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
