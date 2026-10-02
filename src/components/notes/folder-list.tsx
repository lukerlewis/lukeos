import { ChevronRight, Folder as FolderIcon } from "lucide-react";
import Link from "next/link";
import type { Folder } from "@/core/folders";

/** A list of folders, e.g. inside a Card. Each row opens the folder. */
export function FolderList({ folders, showProject = true }: { folders: Folder[]; showProject?: boolean }) {
  return (
    <ul>
      {folders.map((f) => (
        <li key={f.id} className="border-b last:border-b-0">
          <Link href={`/notes?folder=${f.id}`} className="press-tint flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
            <FolderIcon className="size-[18px] shrink-0 text-muted-foreground md:size-4" aria-hidden />
            <span className="min-w-0 grow truncate text-[15px] font-medium md:text-sm">{f.name}</span>
            {showProject && f.project && (
              <span className="inline-flex min-w-0 shrink items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-2 shrink-0 rounded-[3px]" style={{ background: f.project.hex }} aria-hidden />
                <span className="truncate">{f.project.name}</span>
              </span>
            )}
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{f.noteCount}</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
