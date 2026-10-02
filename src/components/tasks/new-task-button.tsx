"use client";

import { Plus } from "lucide-react";
import { Fab } from "@/components/shell/fab";
import { Button } from "@/components/ui/button";
import type { Bucket } from "@/lib/task-fields";
import { useTaskEditor } from "./task-editor";

type Defaults = { projectId?: string | null; bucket?: Bucket };

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
  return <Fab label="New task" onClick={() => newTask(defaults)} />;
}
