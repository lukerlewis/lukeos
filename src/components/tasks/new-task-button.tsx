"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTaskEditor } from "./task-editor";

type Defaults = { projectId?: string | null; dueDate?: string | null };

/** "New" in the top bar on computers. */
export function NewTaskHeaderButton({ defaults }: { defaults?: Defaults }) {
  const { newTask } = useTaskEditor();
  return (
    <Button size="sm" onClick={() => newTask(defaults)}>
      <Plus className="size-4" aria-hidden />
      New task
    </Button>
  );
}

/** The round "+" floating above the tab bar on phones. */
export function NewTaskFab({ defaults }: { defaults?: Defaults }) {
  const { newTask } = useTaskEditor();
  return (
    <button
      type="button"
      onClick={() => newTask(defaults)}
      aria-label="New task"
      className="fixed right-5 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-10 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_8px_24px_rgba(0,0,0,0.18)] md:hidden"
    >
      <Plus className="size-6" strokeWidth={2} aria-hidden />
    </button>
  );
}
