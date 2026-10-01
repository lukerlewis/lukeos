"use client";

import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { showTrashedToast } from "@/components/shell/toast";
import { op } from "@/lib/ops-client";
import { projectColorNames, projectColors, type ProjectColor } from "@/lib/project-colors";
import { cn } from "@/lib/utils";

type Existing = { id: string; name: string; color: ProjectColor };

export function ProjectDialog({ project, onClose }: { project?: Existing; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState<ProjectColor | undefined>(project?.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the project a name.");
    setBusy(true);
    setError(null);
    try {
      if (project) {
        await op("update_project", { id: project.id, name: name.trim(), color });
        router.refresh();
      } else {
        const created = await op("create_project", { name: name.trim(), color });
        router.push(`/projects/${created.id}`);
        router.refresh();
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!project) return;
    if (!confirm(`Move "${project.name}" and all its tasks and notes to Trash? You can get them back within 30 days.`)) return;
    setBusy(true);
    try {
      await op("delete_project", { id: project.id });
      showTrashedToast("project", project.id, () => router.push(`/projects/${project.id}`));
      router.push("/projects");
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog label={project ? "Edit project" : "New project"} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-4 px-5 pt-5">
        <h2 className="text-lg font-semibold">{project ? "Edit project" : "New project"}</h2>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Kitchen renovation"
            className="h-10 rounded-lg border bg-card px-3 text-[16px] shadow-xs outline-none md:text-[15px] focus-visible:border-ring"
          />
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pb-1.5 text-xs font-medium text-muted-foreground">Colour</legend>
          <div className="flex flex-wrap gap-2">
            {projectColorNames.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                aria-pressed={color === c}
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg ring-offset-2 ring-offset-card",
                  color === c && "ring-2 ring-foreground",
                )}
                style={{ background: projectColors[c] }}
              >
                {color === c && <Check className="size-4 text-white" aria-hidden />}
              </button>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="-mx-5 flex items-center gap-2 border-t px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          {project && (
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
            {busy ? "Saving…" : project ? "Save" : "Create project"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The sidebar's small "+" next to Projects. */
export function NewProjectIconButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="New project"
        title="New project"
        className="-m-1 flex rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-[15px]" aria-hidden />
      </button>
      {open && <ProjectDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function NewProjectButton({ variant = "outline" }: { variant?: "outline" | "primary" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        New project
      </Button>
      {open && <ProjectDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function EditProjectButton({ project }: { project: Existing }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-3.5" aria-hidden />
        Edit
      </Button>
      {open && <ProjectDialog project={project} onClose={() => setOpen(false)} />}
    </>
  );
}
