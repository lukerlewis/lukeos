"use client";

import { Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { XPerson } from "@/core/x-feed";
import { hide, inBackground, unhide, useWithoutHidden } from "@/lib/background";
import { op } from "@/lib/ops-client";

/** The people in the feed: add someone by their X username, or take them out. */
export function PeopleButton({ people }: { people: XPerson[] }) {
  const [open, setOpen] = useState(people.length === 0);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Users aria-hidden />
        People
      </Button>
      {open && <PeopleDialog people={people} onClose={() => setOpen(false)} />}
    </>
  );
}

function PeopleDialog({ people, onClose }: { people: XPerson[]; onClose: () => void }) {
  const router = useRouter();
  const shown = useWithoutHidden(people);
  const [handle, setHandle] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Removing takes their saved posts with it, so it asks for a second tap.
  const [confirming, setConfirming] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!handle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await op("follow_x_person", { handle: handle.trim(), ...(company.trim() && { company: company.trim() }) });
      setHandle("");
      setCompany("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function remove(p: XPerson) {
    hide(p.id);
    void inBackground(() => op("unfollow_x_person", { id: p.id }), {
      then: () => router.refresh(),
      failed: () => unhide(p.id),
      failure: `Couldn't remove @${p.handle}.`,
    });
  }

  function saveCompany(p: XPerson, value: string) {
    const next = value.trim();
    if (next === (p.company ?? "")) return;
    void inBackground(() => op("update_x_person", { id: p.id, company: next || null }), {
      then: () => router.refresh(),
      failure: "Couldn't save the company.",
    });
  }

  return (
    <Dialog label="People" onClose={onClose}>
      <div className="flex flex-col gap-4 px-5 pt-5">
        <h2 className="text-lg font-medium">People</h2>
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <input
            autoFocus
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="@username"
            aria-label="X username"
            className="h-11 min-w-0 grow basis-32 rounded-lg border border-stroke-strong bg-card px-3 text-body outline-none focus-visible:border-ring md:text-control"
          />
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company"
            aria-label="Company"
            className="h-11 min-w-0 grow basis-28 rounded-lg border border-stroke-strong bg-card px-3 text-body outline-none focus-visible:border-ring md:text-control"
          />
          <Button type="submit" disabled={busy || !handle.trim()}>
            Add
          </Button>
        </form>
        {error && (
          <p role="alert" className="-mt-2 text-meta text-danger">
            {error}
          </p>
        )}
        {shown.length > 0 && (
          <ul className="-mx-5 border-t">
            {shown.map((p) => (
              <li key={p.id} className="flex items-center gap-3 border-b py-2 pr-3 pl-5 last:border-b-0">
                <a href={p.url} target="_blank" rel="noreferrer" className="flex min-w-0 grow flex-col">
                  <span className="truncate text-control font-medium">{p.name || `@${p.handle}`}</span>
                  {p.name && <span className="truncate text-meta text-muted-foreground">@{p.handle}</span>}
                </a>
                <input
                  defaultValue={p.company ?? ""}
                  onBlur={(e) => saveCompany(p, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  placeholder="Company"
                  aria-label={`Where ${p.name || p.handle} works`}
                  className="h-9 w-28 shrink-0 rounded-lg bg-transparent px-2 text-right text-body text-subtle-foreground outline-none placeholder:text-muted-foreground hover:bg-muted focus-visible:bg-muted md:text-control"
                />
                {confirming === p.id ? (
                  <Button size="sm" variant="outline" onClick={() => remove(p)}>
                    Remove
                  </Button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(p.id)}
                    aria-label={`Remove @${p.handle}`}
                    className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="-mx-5 flex justify-end border-t px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
