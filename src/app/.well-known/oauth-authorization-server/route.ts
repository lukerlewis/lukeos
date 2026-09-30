import { json, originOf, preflight } from "@/lib/auth/oauth";

/** Where Claude registers, sends Luke to approve, and fetches its key. */
export function GET(req: Request) {
  const origin = originOf(req);
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ["lukeos"],
  });
}

export const OPTIONS = preflight;
