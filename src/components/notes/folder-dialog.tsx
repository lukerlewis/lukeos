"use client";

import { FolderPlus, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { op } from "@/lib/ops-client";

type Existing = { id: string; name: string; projectId: string | null };
type ProjectOption = { id: string; name: string };

const field = "h-10 rounded-lg border bg-card px-3 text-body border-stroke-strong outline-none md:text-control focus-visible:border-ring";

export function FolderDialog({
  folder,
  projects,
  projectId: startProject,
  onClose,
}: {
  folder?: Existing;
  projects: ProjectOption[];
  /** For a new folder: the project to attach it to. */
  projectId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(folder?.name ?? "");
  const [projectId, setProjectId] = useState(folder ? folder.projectId : (startProject ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the folder a name.");
    setBusy(true);
    setError(null);
    try {
      if (folder) {
        await op("update_folder", { id: folder.id, name: name.trim(), projectId });
      } else {
        const created = await op("create_folder", { name: name.trim(), projectId });
        // From Notes, open the new folder; from a project, stay on the project.
        if (!startProject) router.push(`/notes?folder=${created.id}`);
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!folder) return;
    if (!confirm(`Delete the folder "${folder.name}"? Its notes are kept.`)) return;
    setBusy(true);
    try {
      await op("delete_folder", { id: folder.id });
      router.push("/notes");
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog label={folder ? "Edit folder" : "New folder"} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-4 px-5 pt-5">
        <h2 className="text-lg font-semibold">{folder ? "Edit folder" : "New folder"}</h2>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Project</span>
          <select value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value || null)} className={field}>
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="text-meta text-danger">
            {error}
          </p>
        )}
        <div className="-mx-5 flex items-center gap-2 border-t px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          {folder && (
            <Button variant="danger" onClick={remove} disabled={busy} className="-ml-2">
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
          )}
          <div className="grow" />
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : folder ? "Save" : "Create folder"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function NewFolderButton({ projects, projectId }: { projects: ProjectOption[]; projectId?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <FolderPlus className="size-4" aria-hidden />
        New folder
      </Button>
      {open && <FolderDialog projects={projects} projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  );
}

export function EditFolderButton({ folder, projects }: { folder: Existing; projects: ProjectOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-3.5" aria-hidden />
        Edit
      </Button>
      {open && <FolderDialog folder={folder} projects={projects} onClose={() => setOpen(false)} />}
    </>
  );
}
