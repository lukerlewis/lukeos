"use client";

import { CheckSquare, FileText, Folder, Globe } from "lucide-react";
import Link from "next/link";
import { useTaskEditor } from "@/components/tasks/task-editor";
import type { ClaudeItem } from "@/core/from-claude";
import { op } from "@/lib/ops-client";

const kindLabel = { note: "Note", task: "Task", project: "Project" } as const;

/** Things Claude made, newest first, with a dot on the ones Luke hasn't seen. */
export function ClaudeItemList({ items, when }: { items: ClaudeItem[]; when: Record<string, string> }) {
  const { openTask } = useTaskEditor();

  return (
    <ul>
      {items.map((item) => {
        const body = <ItemBody item={item} when={when[item.id]} />;
        const row = "flex w-full items-start gap-3 px-4 py-3 hover:bg-muted/50";
        return (
          <li key={`${item.type}-${item.id}`} className="border-b last:border-b-0">
            {item.type === "task" ? (
              <button
                type="button"
                className={row}
                onClick={async () => {
                  try {
                    openTask(await op("get_task", { id: item.id }));
                  } catch (err) {
                    alert((err as Error).message);
                  }
                }}
              >
                {body}
              </button>
            ) : (
              <Link href={item.type === "note" ? `/notes/${item.id}` : `/projects/${item.id}`} className={row}>
                {body}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The inside of a row: icon (with a dot if new), title, time, excerpt and who made it. */
export function ItemBody({ item, when }: { item: ClaudeItem; when: string }) {
  const Icon = item.type === "task" ? CheckSquare : item.type === "project" ? Folder : item.format === "html" ? Globe : FileText;
  return (
    <>
      <span className="relative mt-0.5 shrink-0">
        <Icon className="size-[18px] text-muted-foreground md:size-4" aria-hidden />
        {item.isNew && (
          <span className="absolute -top-1 -right-1 size-2 rounded-full bg-doing ring-2 ring-card" aria-label="New" />
        )}
      </span>
      <span className="flex min-w-0 grow flex-col gap-0.5 text-left">
        <span className="flex items-baseline gap-3">
          <span className="min-w-0 grow truncate text-[15px] font-medium md:text-sm">{item.title || "Untitled"}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{when}</span>
        </span>
        {item.excerpt && <span className="line-clamp-2 text-[13px] text-muted-foreground">{item.excerpt}</span>}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
          <span>{item.format === "html" ? "Saved page" : kindLabel[item.type]}</span>
          <span>{item.routine ? `${item.name}, ${item.routine}` : item.name}</span>
          {item.project && (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-[3px]" style={{ background: item.project.hex }} aria-hidden />
              {item.project.name}
            </span>
          )}
        </span>
      </span>
    </>
  );
}
