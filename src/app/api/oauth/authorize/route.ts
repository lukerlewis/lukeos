import { NextResponse } from "next/server";
import { checkAuthorizeRequest, createAuthCode } from "@/lib/auth/oauth";
import { getSession } from "@/lib/auth/session";

/** Luke tapped Allow or Cancel on the approval screen. */
export async function POST(req: Request) {
  const form = await req.formData();
  const params = new URLSearchParams([...form.entries()].map(([k, v]) => [k, String(v)]));
  if (!(await getSession())) {
    return NextResponse.redirect(new URL(`/oauth/authorize?${params}`, req.url), 303);
  }
  const check = await checkAuthorizeRequest(params);
  if (!check.ok) return new NextResponse(check.error, { status: 400 });

  if (params.get("decision") !== "allow") {
    return NextResponse.redirect(check.back({ error: "access_denied" }), 303);
  }
  const code = await createAuthCode({
    clientId: check.client.id,
    redirectUri: check.redirectUri,
    codeChallenge: check.codeChallenge,
  });
  return NextResponse.redirect(check.back({ code }), 303);
}
