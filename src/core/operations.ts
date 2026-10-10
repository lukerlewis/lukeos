import "server-only";
import { z } from "zod";
import { passkeyCount } from "@/lib/auth/passkeys";
import { activityOperations } from "./activity";
import { archiveOperations } from "./archive";
import { artifactOperations } from "./artifacts";
import { boardOperations } from "./board";
import { bulkOperations } from "./bulk";
import { commentOperations } from "./comments";
import { dashboardOperations } from "./dashboard";
import { documentOperations } from "./documents";
import { defineOperation, OperationError, type Actor, type Operation } from "./define";
import { focusOperations } from "./focus";
import { folderOperations } from "./folders";
import { inspirationOperations } from "./inspiration";
import { fromClaudeOperations } from "./from-claude";
import { mentionOperations } from "./mentions";
import { messageOperations } from "./messages";
import { noteOperations } from "./notes";
import { pipelineOperations } from "./pipeline";
import { projectOperations } from "./projects";
import { routineOperations } from "./routines";
import { searchOperations } from "./search";
import { rollOverLists } from "./rollover";
import { getTimeZone, settingsOperations, today } from "./settings";
import { skillOperations } from "./skills";
import { contextOperations } from "./context";
import { taskOperations } from "./tasks";
import { trashOperations } from "./trash";
import { whiteboardOperations } from "./whiteboards";

export type { Actor, Operation } from "./define";

/**
 * Every action in LukeOS is an operation defined once, with a typed input.
 * The app's screens call operations, and the same list is what the Claude
 * connector (step 3) exposes as tools, so a new feature is usable by Claude
 * as soon as its operation is added here.
 */
export const operations = {
  get_app_info: defineOperation({
    name: "get_app_info",
    description: "Basic facts about this LukeOS install: today's date and time zone, and how many devices can sign in.",
    input: z.object({}),
    run: async () => ({
      app: "LukeOS",
      today: await today(),
      timeZone: await getTimeZone(),
      devices: await passkeyCount(),
    }),
  }),
  ...taskOperations,
  ...boardOperations,
  ...dashboardOperations,
  ...projectOperations,
  ...pipelineOperations,
  ...documentOperations,
  ...noteOperations,
  ...folderOperations,
  ...archiveOperations,
  ...whiteboardOperations,
  ...inspirationOperations,
  ...artifactOperations,
  ...commentOperations,
  ...mentionOperations,
  ...messageOperations,
  ...focusOperations,
  ...bulkOperations,
  ...fromClaudeOperations,
  ...skillOperations,
  ...contextOperations,
  ...routineOperations,
  ...activityOperations,
  ...searchOperations,
  ...trashOperations,
  ...settingsOperations,
} satisfies Record<string, Operation>;

export type Operations = typeof operations;
export type OperationName = keyof Operations;

/** Skills used to be called SOPs. Claude sessions that started before the rename still use the old tool names. */
const renamed: Record<string, string> = {
  list_sops: "list_skills",
  get_sop: "get_skill",
  create_sop: "create_skill",
  update_sop: "update_skill",
  delete_sop: "delete_skill",
};

/** Turns an old tool name and its old field names (sopId, type "sop") into today's. */
export function resolveLegacy(name: string, input: unknown): { name: string; input: unknown } {
  name = renamed[name] ?? name;
  if (!input || typeof input !== "object" || Array.isArray(input)) return { name, input };
  const { sopId, ...rest } = input as Record<string, unknown>;
  const next: Record<string, unknown> = sopId !== undefined && rest.skillId === undefined ? { ...rest, skillId: sopId } : rest;
  if (next.type === "sop") next.type = "skill";
  return { name, input: next };
}

export async function runOperation(rawName: string, rawInputBefore: unknown, actor: Actor) {
  const { name, input: rawInput } = resolveLegacy(rawName, rawInputBefore);
  const op = Object.hasOwn(operations, name) ? (operations as Record<string, Operation>)[name] : undefined;
  if (!op) return { ok: false as const, status: 404, error: `Unknown operation "${name}".` };
  const parsed = op.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: z.prettifyError(parsed.error) };
  try {
    // Tomorrow becomes Today at midnight before anything reads or moves a task.
    await rollOverLists();
    return { ok: true as const, result: await op.run(parsed.data, { actor }) };
  } catch (err) {
    if (err instanceof OperationError) return { ok: false as const, status: err.status, error: err.message };
    throw err;
  }
}
