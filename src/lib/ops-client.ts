import type { z } from "zod";
import type { OperationName, Operations } from "@/core/operations";

/** Runs an operation from the browser, as Luke. Throws with a readable message on failure. */
export async function op<N extends OperationName>(
  name: N,
  input: z.input<Operations[N]["input"]>,
): Promise<Awaited<ReturnType<Operations[N]["run"]>>> {
  const res = await fetch(`/api/ops/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Something went wrong. Try again.");
  return body;
}
