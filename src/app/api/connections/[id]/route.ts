import { NextResponse } from "next/server";
import { revokeConnection } from "@/lib/auth/oauth";
import { getSession } from "@/lib/auth/session";

/** Disconnect a Claude connection. Its key stops working straight away. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/connections/[id]">) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await revokeConnection(id))) {
    return NextResponse.json({ error: "That connection doesn't exist." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
