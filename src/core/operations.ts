import "server-only";
import { z } from "zod";
import { passkeyCount } from "@/lib/auth/passkeys";
import { activityOperations } from "./activity";
import { artifactOperations } from "./artifacts";
import { boardOperations } from "./board";
import { bulkOperations } from "./bulk";
import { commentOperations } from "./comments";
import { dashboardOperations } from "./dashboard";
import { defineOperation, OperationError, type Actor, type Operation } from "./define";
import { fromClaudeOperations } from "./from-claude";
import { noteOperations } from "./notes";
import { projectOperations } from "./projects";
import { searchOperations } from "./search";
import { getTimeZone, settingsOperations, today } from "./settings";
import { taskOperations } from "./tasks";
import { trashOperations } from "./trash";

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
  ...noteOperations,
  ...artifactOperations,
  ...commentOperations,
  ...bulkOperations,
  ...fromClaudeOperations,
  ...activityOperations,
  ...searchOperations,
  ...trashOperations,
  ...settingsOperations,
} satisfies Record<string, Operation>;

export type Operations = typeof operations;
export type OperationName = keyof Operations;

export async function runOperation(name: string, rawInput: unknown, actor: Actor) {
  const op = Object.hasOwn(operations, name) ? (operations as Record<string, Operation>)[name] : undefined;
  if (!op) return { ok: false as const, status: 404, error: `Unknown operation "${name}".` };
  const parsed = op.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: z.prettifyError(parsed.error) };
  try {
    return { ok: true as const, result: await op.run(parsed.data, { actor }) };
  } catch (err) {
    if (err instanceof OperationError) return { ok: false as const, status: err.status, error: err.message };
    throw err;
  }
}
