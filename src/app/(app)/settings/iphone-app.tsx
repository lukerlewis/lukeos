"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * The key that lets LukeOS send notifications to the iPhone app. Luke makes it once
 * in his Apple developer account (Keys, Apple Push Notifications service) and adds
 * the file here with its Key ID. Only whether there is one is ever shown back.
 */
export function IPhoneAppKey({ keyId, phones }: { keyId: string | null; phones: number }) {
  const [saved, setSaved] = useState(keyId);
  const [id, setId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  async function save() {
    if (!file) return;
    setBusy(true);
    setNote(null);
    const res = await fetch("/api/push/apns/key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyId: id.trim().toUpperCase(), p8: await file.text() }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNote(body.error ?? "Couldn't save the key.");
    setSaved(body.key?.keyId ?? null);
    setId("");
    setFile(null);
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <p className="text-meta text-muted-foreground">
        {saved ? `Apple key ${saved} added.` : "No Apple key yet."}
        {phones > 0 && ` ${phones} ${phones === 1 ? "iPhone has" : "iPhones have"} notifications on.`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={picker}
          type="file"
          accept=".p8"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            setFile(picked);
            // Apple names the file AuthKey_<Key ID>.p8, so the Key ID fills itself in.
            const fromName = picked?.name.match(/AuthKey_([A-Z0-9]{10})\.p8$/i)?.[1];
            if (fromName) setId(fromName.toUpperCase());
          }}
        />
        <Button variant="outline" size="sm" onClick={() => picker.current?.click()}>
          {file ? file.name : saved ? "Choose a new key file" : "Choose the key file"}
        </Button>
        {file && (
          <>
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="Key ID"
              aria-label="Key ID"
              maxLength={10}
              className="h-9 w-32 rounded-lg px-3 text-preview"
            />
            <Button size="sm" onClick={save} disabled={busy || id.trim().length !== 10}>
              Save
            </Button>
          </>
        )}
      </div>
      {note && <p className="text-meta text-muted-foreground">{note}</p>}
    </div>
  );
}
