"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Fab } from "@/components/shell/fab";
import { Button } from "@/components/ui/button";
import type { EntrySize } from "@/lib/archive";
import { op } from "@/lib/ops-client";

/** Makes an empty entry (of the size being looked at, if any) and opens it. */
function useNewEntry(size?: EntrySize) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const entry = await op("create_archive_entry", { size });
      router.push(`/archive/${entry.id}?new=1`);
    } catch (err) {
      alert((err as Error).message);
      setBusy(false);
    }
  }

  return { create, busy };
}

export function NewEntryButton({ size, className }: { size?: EntrySize; className?: string }) {
  const { create, busy } = useNewEntry(size);
  return (
    <Button size="sm" onClick={create} disabled={busy} className={className}>
      <Plus className="size-4" aria-hidden />
      New entry
    </Button>
  );
}

/** The round "+" on phones. */
export function NewEntryFab({ size }: { size?: EntrySize }) {
  const { create, busy } = useNewEntry(size);
  return <Fab label="New entry" onClick={create} disabled={busy} />;
}
