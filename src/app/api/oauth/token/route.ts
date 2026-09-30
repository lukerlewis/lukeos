import {
  clientSecretMatches,
  createConnection,
  getClient,
  json,
  pkceMatches,
  preflight,
  refreshConnection,
  takeAuthCode,
} from "@/lib/auth/oauth";

const fail = (error: string, description: string, status = 400) =>
  json({ error, error_description: description }, { status });

/** Claude swaps the one-time code (or its refresh token) for a key here. */
export async function POST(req: Request) {
  const form = await readForm(req);
  const basic = basicAuth(req);
  const clientId = basic?.id ?? form.get("client_id");
  const secret = basic?.secret ?? form.get("client_secret");
  if (!clientId) return fail("invalid_client", "client_id is required.", 401);
  const client = await getClient(clientId);
  if (!client || !clientSecretMatches(client, secret)) return fail("invalid_client", "Unknown client.", 401);

  const grant = form.get("grant_type");
  if (grant === "authorization_code") {
    const code = await takeAuthCode(form.get("code") ?? "");
    const verifier = form.get("code_verifier");
    if (!code || code.clientId !== client.id) return fail("invalid_grant", "That code is unknown or has expired.");
    if (form.get("redirect_uri") && form.get("redirect_uri") !== code.redirectUri) {
      return fail("invalid_grant", "redirect_uri doesn't match.");
    }
    if (!verifier || !pkceMatches(verifier, code.codeChallenge)) return fail("invalid_grant", "PKCE check failed.");
    return json(await createConnection(client));
  }

  if (grant === "refresh_token") {
    const tokens = await refreshConnection(form.get("refresh_token") ?? "", client.id);
    if (!tokens) return fail("invalid_grant", "This connection was disconnected in LukeOS. Connect again.");
    return json(tokens);
  }

  return fail("unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
}

export const OPTIONS = preflight;

async function readForm(req: Request) {
  const text = await req.text();
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text || "{}");
    } catch {}
    return new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(text);
}

function basicAuth(req: Request) {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return null;
  const [id, secret] = Buffer.from(header.slice(6), "base64").toString().split(":");
  return { id: decodeURIComponent(id), secret: decodeURIComponent(secret ?? "") };
}
