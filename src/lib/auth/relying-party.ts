import "server-only";

export const RP_NAME = "LukeOS";

/**
 * Passkeys are tied to the web address they were made on. We read it from
 * the request so the same code works on localhost and on the live address.
 */
export function relyingParty(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const rpID = host.split(":")[0];
  return { rpID, origin: `${proto}://${host}` };
}

/** A friendly name for the device a passkey was made on, e.g. "iPhone". */
export function deviceNameFromUserAgent(ua: string | null) {
  if (!ua) return "Unknown device";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows computer";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Linux/.test(ua)) return "Linux computer";
  return "Unknown device";
}
