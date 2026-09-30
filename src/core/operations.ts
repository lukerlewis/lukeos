import "server-only";
import { z } from "zod";
import { passkeyCount } from "@/lib/auth/passkeys";

/**
 * Every action in LukeOS is an operation defined here, once, with a typed
 * input. The app's screens call operations, and the same list is what the
 * Claude connector (step 3) exposes as tools, so a new feature is usable by
 * Claude as soon as its operation exists.
 */

/** Who is doing something: Luke in the app, or Claude (optionally a named routine). */
export type Actor = { kind: "user" } | { kind: "agent"; name: string; routine?: string };

export type Operation<I extends z.ZodType = z.ZodType, O = unknown> = {
  name: string;
  description: string;
  input: I;
  run: (input: z.infer<I>, ctx: { actor: Actor }) => Promise<O>;
};

function defineOperation<I extends z.ZodType, O>(op: Operation<I, O>) {
  return op;
}

export const operations = {
  get_app_info: defineOperation({
    name: "get_app_info",
    description: "Basic facts about this LukeOS install, such as how many devices can sign in.",
    input: z.object({}),
    run: async () => ({ app: "LukeOS", devices: await passkeyCount() }),
  }),
} satisfies Record<string, Operation>;

export type OperationName = keyof typeof operations;

export async function runOperation(name: string, rawInput: unknown, actor: Actor) {
  const op = (operations as Record<string, Operation>)[name];
  if (!op) return { ok: false as const, status: 404, error: `Unknown operation "${name}".` };
  const parsed = op.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: z.prettifyError(parsed.error) };
  return { ok: true as const, result: await op.run(parsed.data, { actor }) };
}
