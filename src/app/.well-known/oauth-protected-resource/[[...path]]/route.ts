import { json, mcpUrl, originOf, preflight } from "@/lib/auth/oauth";

/** Tells Claude that the connector at /api/mcp signs in through LukeOS itself. */
export function GET(req: Request) {
  const origin = originOf(req);
  return json({
    resource: mcpUrl(origin),
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    resource_name: "LukeOS",
  });
}

export const OPTIONS = preflight;
