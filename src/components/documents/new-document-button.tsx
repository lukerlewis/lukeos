"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Fab } from "@/components/shell/fab";
import { Button } from "@/components/ui/button";
import { op } from "@/lib/ops-client";

/** Makes an empty document (in a project, if given) and opens it. */
function useNewDocument(projectId?: string | null) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const doc = await op("create_document", { title: "", projectId: projectId ?? null });
      router.push(`/documents/${doc.id}?new=1`);
    } catch (err) {
      alert((err as Error).message);
      setBusy(false);
    }
  }

  return { create, busy };
}

export function NewDocumentButton({
  projectId,
  variant = "primary",
  className,
}: {
  projectId?: string | null;
  variant?: "primary" | "outline";
  className?: string;
}) {
  const { create, busy } = useNewDocument(projectId);
  return (
    <Button size="sm" variant={variant} onClick={create} disabled={busy} className={className}>
      <Plus className="size-4" aria-hidden />
      New document
    </Button>
  );
}

/** The round "+" on phones. */
export function NewDocumentFab() {
  const { create, busy } = useNewDocument();
  return <Fab label="New document" onClick={create} disabled={busy} />;
}
