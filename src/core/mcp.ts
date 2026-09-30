import "server-only";
import { z } from "zod";
import type { Actor } from "./define";
import { operations, runOperation } from "./operations";

/**
 * The Claude connector speaks MCP (JSON-RPC over HTTP). Its tools are the
 * operations list, so anything added to operations.ts shows up here too.
 */

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `LukeOS is Luke's personal app for projects and tasks (notes are coming later).
- Call get_today first to learn today's date in Luke's time zone and what's due. Due dates are plain days (YYYY-MM-DD); work out "Friday" or "next week" from that date.
- Everything you create is labelled in the app as made by Claude. If you are running as a scheduled routine, pass the routine's name as "routine" so Luke can see which one did it.
- Deleting moves things to Trash, where they're kept for 30 days.`;

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
        const outcome = await runOperation(name, input, who);
        if (!outcome.ok) return result(msg.id, { content: [{ type: "text", text: outcome.error }], isError: true });
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
