import { NextResponse } from "next/server";
import { runOperation } from "@/core/operations";
import { getSession } from "@/lib/auth/session";

/** Runs one operation for the signed-in user. Claude uses the connector at /api/mcp instead. */
export async function POST(req: Request, ctx: RouteContext<"/api/ops/[name]">) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { name } = await ctx.params;
  const input = await req.json().catch(() => ({}));
  const outcome = await runOperation(name, input, { kind: "user" });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json(outcome.result);
}
