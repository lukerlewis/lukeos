"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fab } from "@/components/shell/fab";
import { Button } from "@/components/ui/button";
import { newNoteHref } from "@/lib/new-items";

type Place = { projectId?: string | null; folderId?: string | null };

/** Opens an empty note (in a project or folder, if given) at once; its page makes it as it opens. */
function useNewNote({ projectId, folderId }: Place = {}) {
  const router = useRouter();
  const create = () => router.push(newNoteHref({ projectId, folderId }));
  return create;
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
  const create = useNewNote({ projectId, folderId });
  return (
    <Button size="sm" variant={variant} onClick={create} className={className}>
      <Plus className="size-4" aria-hidden />
      New note
    </Button>
  );
}

/** The round "+" on phones. */
export function NewNoteFab({ folderId }: { folderId?: string | null }) {
  const create = useNewNote({ folderId });
  return <Fab label="New note" onClick={create} />;
}
