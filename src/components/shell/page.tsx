import Link from "next/link";
import { cn } from "@/lib/utils";
import { NewTaskFab, NewTaskHeaderButton } from "@/components/tasks/new-task-button";
import { AddNew } from "./add-new";

/**
 * The frame every screen sits in: a slim top bar on computers, and a large
 * title with the settings button on phones.
 */
export function Page({
  title,
  eyebrow,
  heading,
  actions,
  newTask,
  addNew,
  fill,
  children,
}: {
  title: string;
  eyebrow?: React.ReactNode;
  heading?: React.ReactNode;
  /** Extra buttons beside the heading. */
  actions?: React.ReactNode;
  /** Show the New task buttons, pre-filled with these (false hides them). */
  newTask?: false | { projectId?: string | null; dueDate?: string | null };
  /** On computers, show "Add new" (task, note, project) instead of New task. */
  addNew?: boolean;
  /** The content fills the screen down to the tab bar, for screens with a box pinned to the bottom (Messages). */
  fill?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 grow flex-col">
      <header className="hidden h-14 shrink-0 items-center border-b px-6 md:flex">
        <span className="grow font-medium">{title}</span>
        {addNew ? <AddNew /> : newTask !== false && <NewTaskHeaderButton defaults={newTask} />}
      </header>
      <div
        className={cn(
          "flex flex-col gap-6 px-5 pt-[max(env(safe-area-inset-top),1rem)] md:px-10 md:pt-8",
          fill ? "grow pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0" : "pb-28 md:pb-10",
        )}
      >
        <div className="flex items-end justify-between gap-4 pt-8 md:pt-0">
          <div className="min-w-0">
            {eyebrow && <div className="text-[13px] text-muted-foreground">{eyebrow}</div>}
            <h1 className="mt-0.5 text-[30px] font-semibold tracking-tight break-words md:mt-1 md:text-[28px]">
              {heading ?? title}
            </h1>
          </div>
          <div className="grow" />
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          <Link
            href="/settings"
            aria-label="Settings"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground md:hidden"
          >
            L
          </Link>
        </div>
        {children}
      </div>
      {/* Phones have no menu: the "+" always adds a task. */}
      {newTask !== false && <NewTaskFab defaults={newTask} />}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">{children}</p>;
}
