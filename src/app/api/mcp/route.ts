import { handleMcp } from "@/core/mcp";
import { connectionForAccessToken, corsHeaders, json, originOf, preflight } from "@/lib/auth/oauth";

/**
 * The Claude connector. Claude sends MCP requests here with its own key;
 * every tool is an operation from src/core/operations.ts.
 */
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const connection = token ? await connectionForAccessToken(token) : null;
  if (!connection) {
    const metadata = `${originOf(req)}/.well-known/oauth-protected-resource/api/mcp`;
    return json(
      { error: "invalid_token", error_description: "Connect Claude to LukeOS first." },
      {
        status: 401,
        headers: {
          "www-authenticate": `Bearer resource_metadata="${metadata}"${token ? ', error="invalid_token"' : ""}`,
        },
      },
    );
  }

  const message = await req.json().catch(() => undefined);
  const reply = await handleMcp(message, { kind: "agent", name: "Claude" });
  if (reply === null) return new Response(null, { status: 202, headers: corsHeaders });
  return json(reply);
}

// No server-to-Claude stream: every answer comes back on the POST.
export function GET() {
  return new Response("Method not allowed", { status: 405, headers: { allow: "POST", ...corsHeaders } });
}
export const DELETE = GET;
export const OPTIONS = preflight;
