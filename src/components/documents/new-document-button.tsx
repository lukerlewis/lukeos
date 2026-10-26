"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fab } from "@/components/shell/fab";
import { Button } from "@/components/ui/button";
import { newDocumentHref } from "@/lib/new-items";

/** Opens an empty document (in a project, if given) at once; its page makes it as it opens. */
function useNewDocument(projectId?: string | null) {
  const router = useRouter();
  const create = () => router.push(newDocumentHref({ projectId }));
  return create;
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
  const create = useNewDocument(projectId);
  return (
    <Button size="sm" variant={variant} onClick={create} className={className}>
      <Plus className="size-4" aria-hidden />
      New document
    </Button>
  );
}

/** The round "+" on phones. */
export function NewDocumentFab({ projectId }: { projectId?: string | null }) {
  const create = useNewDocument(projectId);
  return <Fab label="New document" onClick={create} />;
}
