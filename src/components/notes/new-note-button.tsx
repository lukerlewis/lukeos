"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Fab } from "@/components/shell/fab";
import { Button } from "@/components/ui/button";
import { op } from "@/lib/ops-client";

type Place = { projectId?: string | null; folderId?: string | null };

/** Makes an empty note (in a project or folder, if given) and opens it. */
function useNewNote({ projectId, folderId }: Place = {}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const note = await op("create_note", { projectId: projectId ?? null, folderId: folderId ?? null });
      router.push(`/notes/${note.id}?new=1`);
    } catch (err) {
      alert((err as Error).message);
      setBusy(false);
    }
  }

  return { create, busy };
}

export function NewNoteButton({
  projectId,
  folderId,
  variant = "primary",
  className,
}: {
  projectId?: string | null;
  folderId?: string | null;
  variant?: "primary" | "outline";
  className?: string;
}) {
  const { create, busy } = useNewNote({ projectId, folderId });
  return (
    <Button size="sm" variant={variant} onClick={create} disabled={busy} className={className}>
      <Plus className="size-4" aria-hidden />
      New note
    </Button>
  );
}

/** The round "+" on phones. */
export function NewNoteFab({ folderId }: { folderId?: string | null }) {
  const { create, busy } = useNewNote({ folderId });
  return <Fab label="New note" onClick={create} disabled={busy} />;
}
