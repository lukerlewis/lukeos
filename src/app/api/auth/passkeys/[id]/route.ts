import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { passkeyCount } from "@/lib/auth/passkeys";
import { getSession } from "@/lib/auth/session";

/** Remove a device's passkey. The last one can't be removed, or nobody could sign in. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/auth/passkeys/[id]">) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((await passkeyCount()) <= 1) {
    return NextResponse.json({ error: "You can't remove your only device." }, { status: 400 });
  }
  const { id } = await ctx.params;
  await db.delete(schema.sessions).where(eq(schema.sessions.passkeyId, id));
  await db.delete(schema.passkeys).where(eq(schema.passkeys.id, id));
  return NextResponse.json({ ok: true });
}
