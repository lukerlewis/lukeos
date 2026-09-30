import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { relyingParty } from "./relying-party";

/**
 * How Claude gets its own key into LukeOS. It's standard OAuth, which is what
 * Claude's custom connectors speak: Claude registers itself, sends Luke to
 * an approval screen here, and gets back a key tied to that one connection.
 * Luke can disconnect any connection in Settings.
 */

const CODE_MINUTES = 5;
const ACCESS_TOKEN_DAYS = 7;

export const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;

/** The public address of this LukeOS, e.g. https://lukeos-kappa.vercel.app. */
export const originOf = (req: Request) => relyingParty(req).origin;
export const mcpUrl = (origin: string) => `${origin}/api/mcp`;

/**
 * Claude only. Claude on the web, desktop and phone sends Luke back to
 * claude.ai (or claude.com); Claude Code on a computer uses a local address.
 */
export function isAllowedRedirect(uri: string) {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  const host = url.hostname;
  if (url.protocol === "https:") {
    return ["claude.ai", "claude.com"].some((d) => host === d || host.endsWith(`.${d}`));
  }
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(host);
}

export async function registerClient(input: { name: string; redirectUris: string[]; wantsSecret: boolean }) {
  const id = randomBytes(16).toString("hex");
  const secret = input.wantsSecret ? newToken("lko_cs") : null;
  await db.insert(schema.oauthClients).values({
    id,
    name: input.name,
    redirectUris: JSON.stringify(input.redirectUris),
    secretHash: secret ? hash(secret) : null,
  });
  return { id, secret };
}

export async function getClient(id: string) {
  const [row] = await db.select().from(schema.oauthClients).where(eq(schema.oauthClients.id, id)).limit(1);
  if (!row) return null;
  return { ...row, redirectUris: JSON.parse(row.redirectUris) as string[] };
}

/** Checks the client's secret, for the few clients that registered with one. */
export function clientSecretMatches(client: { secretHash: string | null }, secret: string | null) {
  if (!client.secretHash) return true;
  if (!secret) return false;
  const a = Buffer.from(hash(secret));
  const b = Buffer.from(client.secretHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Called once Luke taps Allow. Returns the one-time code Claude swaps for its key. */
export async function createAuthCode(input: { clientId: string; redirectUri: string; codeChallenge: string }) {
  const code = newToken("lko_code");
  await db.delete(schema.oauthCodes).where(lt(schema.oauthCodes.expiresAt, new Date()));
  await db.insert(schema.oauthCodes).values({
    id: hash(code),
    ...input,
    expiresAt: new Date(Date.now() + CODE_MINUTES * 60 * 1000),
  });
  return code;
}

/** Uses up a code. Returns what it was issued for, or null if it's unknown or expired. */
export async function takeAuthCode(code: string) {
  const [row] = await db
    .delete(schema.oauthCodes)
    .where(and(eq(schema.oauthCodes.id, hash(code)), gt(schema.oauthCodes.expiresAt, new Date())))
    .returning();
  return row ?? null;
}

export function pkceMatches(verifier: string, challenge: string) {
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

async function issueAccessToken(connectionId: string) {
  const token = newToken("lko_at");
  const now = new Date();
  await db.delete(schema.agentAccessTokens).where(lt(schema.agentAccessTokens.expiresAt, now));
  await db.insert(schema.agentAccessTokens).values({
    id: hash(token),
    connectionId,
    expiresAt: new Date(now.getTime() + ACCESS_TOKEN_DAYS * 24 * 60 * 60 * 1000),
  });
  return { access_token: token, token_type: "Bearer", expires_in: ACCESS_TOKEN_DAYS * 24 * 60 * 60 };
}

/** A new connection: Claude's own key, plus the refresh token it renews it with. */
export async function createConnection(client: { id: string; name: string }) {
  const refreshToken = newToken("lko_rt");
  const [row] = await db
    .insert(schema.agentConnections)
    .values({ clientId: client.id, name: client.name, refreshTokenHash: hash(refreshToken) })
    .returning({ id: schema.agentConnections.id });
  return { ...(await issueAccessToken(row.id)), refresh_token: refreshToken };
}

/** Renews Claude's key. The refresh token keeps working until Luke disconnects. */
export async function refreshConnection(refreshToken: string, clientId: string) {
  const [row] = await db
    .select()
    .from(schema.agentConnections)
    .where(
      and(
        eq(schema.agentConnections.refreshTokenHash, hash(refreshToken)),
        eq(schema.agentConnections.clientId, clientId),
        isNull(schema.agentConnections.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { ...(await issueAccessToken(row.id)), refresh_token: refreshToken };
}

/** The connection behind a key Claude sent, or null if it's unknown, expired or disconnected. */
export async function connectionForAccessToken(token: string) {
  const now = new Date();
  const [row] = await db
    .select({ connection: schema.agentConnections })
    .from(schema.agentAccessTokens)
    .innerJoin(schema.agentConnections, eq(schema.agentConnections.id, schema.agentAccessTokens.connectionId))
    .where(
      and(
        eq(schema.agentAccessTokens.id, hash(token)),
        gt(schema.agentAccessTokens.expiresAt, now),
        isNull(schema.agentConnections.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  // Note when it was last used, at most once a minute.
  await db
    .update(schema.agentConnections)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(schema.agentConnections.id, row.connection.id),
        or(
          isNull(schema.agentConnections.lastUsedAt),
          lt(schema.agentConnections.lastUsedAt, new Date(now.getTime() - 60_000)),
        ),
      ),
    );
  return row.connection;
}

/** Disconnect: the key and its refresh token stop working immediately. */
export async function revokeConnection(id: string) {
  const [row] = await db
    .update(schema.agentConnections)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.agentConnections.id, id), isNull(schema.agentConnections.revokedAt)))
    .returning({ id: schema.agentConnections.id });
  if (row) await db.delete(schema.agentAccessTokens).where(eq(schema.agentAccessTokens.connectionId, id));
  return !!row;
}

/** Answers from the OAuth and MCP endpoints can be called from any site (e.g. connector testing tools). */
export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id",
};

export const preflight = () => new Response(null, { status: 204, headers: corsHeaders });

export function json(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, {
    ...init,
    headers: { "cache-control": "no-store", ...corsHeaders, ...init.headers },
  });
}

/**
 * Checks the request Claude sent Luke to the approval screen with. Problems
 * with the client or return address are shown on screen rather than sent
 * back, so a bad request can't bounce Luke somewhere unexpected.
 */
export async function checkAuthorizeRequest(params: URLSearchParams) {
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const client = clientId ? await getClient(clientId) : null;
  if (!client) return { ok: false as const, error: "This connection request isn't from an app LukeOS knows. Try adding the connector again." };
  if (!client.redirectUris.includes(redirectUri) || !isAllowedRedirect(redirectUri)) {
    return { ok: false as const, error: "This connection request has an unexpected return address, so it was stopped." };
  }
  const state = params.get("state");
  const back = (query: Record<string, string>) => {
    const url = new URL(redirectUri);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    if (state) url.searchParams.set("state", state);
    return url.toString();
  };
  const codeChallenge = params.get("code_challenge") ?? "";
  if (params.get("response_type") !== "code" || !codeChallenge || (params.get("code_challenge_method") ?? "S256") !== "S256") {
    return { ok: false as const, error: "This connection request is missing details LukeOS needs.", back: back({ error: "invalid_request" }) };
  }
  return { ok: true as const, client, redirectUri, codeChallenge, back };
}
