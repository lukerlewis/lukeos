import { isAllowedRedirect, json, preflight, registerClient } from "@/lib/auth/oauth";

/** Claude registers itself here the first time it's added as a connector. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const redirectUris: unknown = body?.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every((u) => typeof u === "string")) {
    return json({ error: "invalid_redirect_uri", error_description: "redirect_uris is required." }, { status: 400 });
  }
  if (!redirectUris.every(isAllowedRedirect)) {
    return json(
      { error: "invalid_redirect_uri", error_description: "LukeOS only connects to Claude." },
      { status: 400 },
    );
  }
  const authMethod: string = body?.token_endpoint_auth_method ?? "none";
  const wantsSecret = authMethod === "client_secret_post" || authMethod === "client_secret_basic";
  const name = typeof body?.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 100) : "Claude";

  const client = await registerClient({ name, redirectUris, wantsSecret });
  return json(
    {
      client_id: client.id,
      ...(client.secret && { client_secret: client.secret, client_secret_expires_at: 0 }),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: wantsSecret ? authMethod : "none",
    },
    { status: 201 },
  );
}

export const OPTIONS = preflight;
