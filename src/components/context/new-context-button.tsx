"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { op } from "@/lib/ops-client";

/** Makes an empty context file and opens it. */
export function NewContextButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const file = await op("create_context", {});
      router.push(`/agents/context/${file.id}?new=1`);
    } catch (err) {
      alert((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Button size="sm" onClick={create} disabled={busy}>
      <Plus className="size-4" aria-hidden />
      New file
    </Button>
  );
}
