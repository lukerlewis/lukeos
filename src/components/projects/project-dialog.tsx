"use client";

import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { showToast } from "@/components/shell/toast";
import { currentArea } from "@/lib/area";
import { inBackground, trashInBackground } from "@/lib/background";
import { op } from "@/lib/ops-client";
import { projectColorNames, projectColors, type ProjectColor } from "@/lib/project-colors";
import { areaLabel, areas, type Area } from "@/lib/task-fields";
import { cn } from "@/lib/utils";

type Existing = { id: string; name: string; color: ProjectColor; area: Area };

export function ProjectDialog({ project, onClose }: { project?: Existing; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState<ProjectColor | undefined>(project?.color);
  const [area, setArea] = useState<Area>(() => project?.area ?? currentArea());
  const [error, setError] = useState<string | null>(null);

  // The box closes at once and the project saves behind it.
  function save(e: React.FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setError("Give the project a name.");
    onClose();
    if (project) {
      if (clean === project.name && color === project.color && area === project.area) return;
      void inBackground(() => op("update_project", { id: project.id, name: clean, color, area }), {
        then: () => router.refresh(),
        failure: "Couldn't save the project.",
      });
    } else {
      // A new project opens once it's made, since its page needs it to exist.
      void inBackground(() => op("create_project", { name: clean, color, area }), {
        then: (created) => {
          showToast("Project added");
          router.push(`/projects/${created.id}`);
          router.refresh();
        },
        failure: `Couldn't add “${clean}”.`,
      });
    }
  }

  function remove() {
    if (!project) return;
    if (!confirm(`Move "${project.name}" and all its tasks and notes to Trash? You can get them back within 30 days.`)) return;
    const id = project.id;
    trashInBackground("project", id, () => op("delete_project", { id }), {
      then: () => router.refresh(),
      onUndone: () => router.push(`/projects/${id}`),
    });
    router.push("/projects");
    onClose();
  }

  return (
    <Dialog label={project ? "Edit project" : "New project"} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-4 px-5 pt-5">
        <h2 className="text-lg font-medium">{project ? "Edit project" : "New project"}</h2>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Kitchen renovation"
            className="h-10 rounded-lg border bg-card px-3 text-body border-stroke-strong outline-none md:text-control focus-visible:border-ring"
          />
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pb-1.5 text-xs font-medium text-muted-foreground">Area</legend>
          <Segmented value={area} onChange={setArea} options={areas.map((a) => ({ value: a, label: areaLabel[a] }))} />
        </fieldset>
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
          <p role="alert" className="text-meta text-danger">
            {error}
          </p>
        )}
        <div className="-mx-5 flex items-center gap-2 border-t px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          {project && (
            <Button variant="danger" onClick={remove} className="-ml-2">
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
          )}
          <div className="grow" />
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">{project ? "Save" : "Create project"}</Button>
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
