"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { op } from "@/lib/ops-client";

/** Makes an empty SOP and opens it. */
export function NewSopButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const sop = await op("create_sop", {});
      router.push(`/agents/sops/${sop.id}?new=1`);
    } catch (err) {
      alert((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Button size="sm" onClick={create} disabled={busy}>
      <Plus className="size-4" aria-hidden />
      New SOP
    </Button>
  );
}
