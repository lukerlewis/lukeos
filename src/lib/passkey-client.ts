"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

async function post(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}

/** Turns browser passkey errors into plain words. Returns null when the person just cancelled. */
export function friendlyPasskeyError(err: unknown): string | null {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return null;
  if (name === "InvalidStateError") return "This device already has a LukeOS passkey.";
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

export async function registerPasskey() {
  const optionsJSON = await post("/api/auth/register/options");
  const response = await startRegistration({ optionsJSON });
  await post("/api/auth/register/verify", response);
}

export async function signInWithPasskey() {
  const optionsJSON = await post("/api/auth/login/options");
  const response = await startAuthentication({ optionsJSON });
  await post("/api/auth/login/verify", response);
}
