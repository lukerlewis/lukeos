"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { op } from "@/lib/ops-client";

/** Makes an empty routine and opens it. It isn't due until it has a name or instructions. */
export function NewRoutineButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const routine = await op("create_routine", {});
      router.push(`/agents/routines/${routine.id}?new=1`);
    } catch (err) {
      alert((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Button size="sm" onClick={create} disabled={busy}>
      <Plus className="size-4" aria-hidden />
      New routine
    </Button>
  );
}
