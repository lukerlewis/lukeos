import "server-only";
import { z } from "zod";

/** Who is doing something: Luke in the app, or Claude (optionally a named routine). */
export type Actor = { kind: "user" } | { kind: "agent"; name: string; routine?: string };

export type Operation<I extends z.ZodType = z.ZodType, O = unknown> = {
  name: string;
  description: string;
  input: I;
  run: (input: z.infer<I>, ctx: { actor: Actor }) => Promise<O>;
};

export function defineOperation<I extends z.ZodType, O>(op: Operation<I, O>) {
  return op;
}

/** A problem with the request (a missing task, a bad date) rather than a crash. */
export class OperationError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** The columns every created thing carries to record who made it. */
export function madeByColumns(actor: Actor) {
  return actor.kind === "user"
    ? { createdByKind: "user", createdByName: null, createdByRoutine: null }
    : { createdByKind: "agent", createdByName: actor.name, createdByRoutine: actor.routine ?? null };
}

export type MadeBy = { kind: "user" | "agent"; name: string | null; routine: string | null };

export function madeByOf(row: { createdByKind: string; createdByName: string | null; createdByRoutine: string | null }): MadeBy {
  return {
    kind: row.createdByKind === "agent" ? "agent" : "user",
    name: row.createdByName,
    routine: row.createdByRoutine,
  };
}
