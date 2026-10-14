import { NextResponse } from "next/server";
import { runOperation } from "@/core/operations";
import { getSession } from "@/lib/auth/session";
import { snapshotReads } from "@/lib/undo-snapshot";

/**
 * Runs one operation for the signed-in user. Claude uses the connector at /api/mcp instead.
 * With ?before=1 it also reads how the thing looked first (for Undo) and answers { result, before }.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/ops/[name]">) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { name } = await ctx.params;
  const input = await req.json().catch(() => ({}));
  const reads = new URL(req.url).searchParams.has("before") ? snapshotReads(name, input ?? {}) : null;
  // Undo still works for everything else if this read fails.
  const before = reads
    ? await Promise.all(reads.map((r) => runOperation(r.name, r.input, { kind: "user" }))).then(
        (all) => (all.every((r) => r.ok) ? all.map((r) => (r as { result: unknown }).result) : null),
        () => null,
      )
    : undefined;
  const outcome = await runOperation(name, input, { kind: "user" });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json(before === undefined ? outcome.result : { result: outcome.result, before });
}
