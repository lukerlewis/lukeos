"use client";

import Link from "next/link";
import { useTaskEditor } from "@/components/tasks/task-editor";
import { op } from "@/lib/ops-client";

export type ActivityRow = {
  id: string;
  /** "2:05 pm", in Luke's time zone. */
  time: string;
  summary: string;
  who: string | null;
  item: { type: "task" | "note" | "artifact" | "document" | "card" | "project" | "sop" | "context" | "routine" | "entry" | "inspiration" | "whiteboard"; id: string } | null;
};

/** The activity log, one day at a time: a time and a short line for each thing Claude did. */
export function ActivityList({ days }: { days: { label: string; rows: ActivityRow[] }[] }) {
  const { openTask } = useTaskEditor();

  return (
    <div className="flex flex-col">
      {days.map((day) => (
        <section key={day.label} className="border-b last:border-b-0">
          <h2 className="bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">{day.label}</h2>
          <ul>
            {day.rows.map((row) => {
              const body = (
                <>
                  <span className="w-14 shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{row.time}</span>
                  <span className="min-w-0 grow text-preview md:text-meta">
                    {row.summary}
                    {row.who && <span className="ml-2 text-meta text-muted-foreground">{row.who}</span>}
                  </span>
                </>
              );
              const cls = "flex w-full items-baseline gap-3 px-4 py-2 text-left";
              const link = cls + "press-tint hover:bg-muted/50";
              return (
                <li key={row.id} className="border-t first:border-t-0">
                  {row.item?.type === "task" ? (
                    <button
                      type="button"
                      className={link}
                      onClick={async () => {
                        try {
                          openTask(await op("get_task", { id: row.item!.id }));
                        } catch {
                          alert("That task isn't there any more.");
                        }
                      }}
                    >
                      {body}
                    </button>
                  ) : row.item ? (
                    <Link
                      href={
                        row.item.type === "sop" || row.item.type === "routine"
                          ? `/agents/${row.item.type}s/${row.item.id}`
                          : row.item.type === "context"
                            ? `/agents/context/${row.item.id}`
                          : row.item.type === "entry"
                            ? `/archive/${row.item.id}`
                            : row.item.type === "inspiration"
                              ? `/inspiration?item=${row.item.id}`
                            : row.item.type === "whiteboard"
                              ? `/whiteboard/${row.item.id}`
                              : `/${row.item.type}s/${row.item.id}`
                      }
                      className={link}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
