"use client";

import { CheckSquare, ChevronDown, FilePlus, FolderPlus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ProjectDialog } from "@/components/projects/project-dialog";
import { useTaskEditor } from "@/components/tasks/task-editor";
import { Button } from "@/components/ui/button";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";

type Open = null | "menu" | "project";

/**
 * "Add new": one button that opens a short menu of what to make (a task, a
 * note or a project). In the top bar on computers; phones get a "+" that adds a task.
 */
export function AddNew() {
  const router = useRouter();
  const { newTask } = useTaskEditor();
  const [open, setOpen] = useState<Open>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open !== "menu") return;
    const click = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("pointerdown", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", click);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const items = [
    { label: "Task", icon: CheckSquare, run: () => newTask() },
    {
      label: "Note",
      icon: FilePlus,
      run: async () => {
        try {
          const note = await op("create_note", {});
          router.push(`/notes/${note.id}?new=1`);
        } catch (err) {
          alert((err as Error).message);
        }
      },
    },
    { label: "Project", icon: FolderPlus, run: () => setOpen("project") },
  ];

  return (
    <div ref={ref} className="relative">
      <Button size="sm" aria-expanded={open === "menu"} onClick={() => setOpen(open === "menu" ? null : "menu")}>
        <Plus className="size-4" aria-hidden />
        Add new
        <ChevronDown className={cn("size-3.5 transition-transform", open === "menu" && "rotate-180")} aria-hidden />
      </Button>

      {open === "menu" && (
        <div
          role="menu"
          className="motion-pop absolute top-full right-0 z-30 mt-2 flex w-56 origin-top-right flex-col rounded-xl border bg-card p-1 shadow-lg"
        >
          {items.map(({ label, icon: Icon, run }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(null);
                void run();
              }}
              className="press-tint flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium hover:bg-muted"
            >
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      )}

      {open === "project" && <ProjectDialog onClose={() => setOpen(null)} />}
    </div>
  );
}
