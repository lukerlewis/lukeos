"use client";

import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Toolbar, useAutosave } from "@/components/notes/note-editor";
import { showTrashedToast } from "@/components/shell/toast";
import { MadeByLabel } from "@/components/tasks/made-by";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import type { Routine } from "@/core/routines";
import { op } from "@/lib/ops-client";
import { checkInsLabel, dayNames, timeLabel, type CheckIns, type Frequency } from "@/lib/schedule";
import { cn } from "@/lib/utils";

const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

export function RoutineEditor({
  routine,
  sops,
  checkIns,
  next,
  autoFocus,
}: {
  routine: Omit<Routine, "runs">;
  sops: { id: string; title: string }[];
  checkIns: CheckIns;
  /** "Today 8pm", worked out on the server. */
  next: string | null;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const { state, queue, flush } = useAutosave(routine.id, "update_routine");
  const [title, setTitle] = useState(routine.title);
  const [enabled, setEnabled] = useState(routine.enabled);
  const [frequency, setFrequency] = useState<Frequency>(routine.frequency);
  const [time, setTime] = useState(routine.time);
  const [days, setDays] = useState(routine.days);
  const [dayOfMonth, setDayOfMonth] = useState(routine.dayOfMonth);
  const [sopId, setSopId] = useState(routine.sop?.id ?? null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // A new routine left completely empty isn't worth keeping, so it's deleted for good when Luke leaves it.
  const hasText = useRef({ title: !!routine.title.trim(), instructions: !!routine.instructions.trim() });
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const text = hasText.current;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current && !text.title && !text.instructions)
          op("delete_routine", { id: routine.id })
            .then(() => op("delete_forever", { type: "routine", id: routine.id }))
            .catch(() => {});
      }, 0);
    };
  }, [routine.id]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({
        placeholder: "What should happen each time?",
      }),
      Markdown,
    ],
    content: routine.instructions,
    contentType: "markdown",
    editorProps: { attributes: { class: "note-body", "aria-label": "Instructions" } },
    onUpdate: ({ editor }) => {
      hasText.current.instructions = !editor.isEmpty;
      queue({ instructions: editor.getMarkdown() });
    },
  });

  useEffect(() => {
    if (autoFocus) titleRef.current?.focus();
  }, [autoFocus]);

  /** Schedule changes save straight away, then the "next" time is worked out again. */
  async function saveSchedule(change: Parameters<typeof queue>[0]) {
    queue(change, 0);
    await flush();
    router.refresh();
  }

  async function remove() {
    await flush();
    try {
      await op("delete_routine", { id: routine.id });
      showTrashedToast("routine", routine.id, () => router.push(`/agents/routines/${routine.id}`));
      router.push("/agents?view=routines");
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  // The time picker offers the check-in times, since that's when routines actually run.
  const times = [...new Set([...checkIns.times, time])].sort();
  const offDays = frequency === "weekly" ? days.filter((d) => !checkIns.days.includes(d)) : [];

  return (
    <div className="flex flex-col gap-3">
      <textarea
        ref={titleRef}
        value={title}
        rows={1}
        maxLength={200}
        onChange={(e) => {
          const next = e.target.value.replace(/\n/g, " ");
          setTitle(next);
          hasText.current.title = !!next.trim();
          queue({ title: next });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            editor?.commands.focus("end");
          }
        }}
        placeholder="Untitled routine"
        aria-label="Title"
        enterKeyHint="next"
        className="field-sizing-content resize-none bg-transparent text-title leading-tight font-medium outline-none placeholder:text-muted-foreground md:text-title"
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-meta text-muted-foreground">
        <span>
          <MadeByLabel madeBy={routine.madeBy} createdAt={routine.createdAt} />
        </span>
        <span aria-live="polite" className={cn(state === "error" && "text-danger")}>
          {state === "saving" ? "Saving..." : state === "error" ? "Not saved yet, retrying" : "Saved"}
        </span>
        <span className="grow" />
        <Button variant="danger" size="sm" onClick={remove} className="-mr-2">
          <Trash2 className="size-4" aria-hidden />
          Delete
        </Button>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border bg-card p-3 border-stroke">
        <div className="flex items-center gap-3">
          <span className="flex min-w-0 grow flex-col">
            <span className="text-meta font-medium">{enabled ? "On" : "Off"}</span>
            <span className="text-meta text-muted-foreground">
              {enabled ? (next ? `Next due ${next}` : "Runs on its schedule") : "Won't run until you switch it on"}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Routine on"
            onClick={() => {
              setEnabled(!enabled);
              void saveSchedule({ enabled: !enabled });
            }}
            className={cn(
              "relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors",
              enabled ? "bg-primary" : "bg-grey-300",
            )}
          >
            <span
              className={cn(
                "absolute top-[2px] left-[2px] size-[27px] rounded-full bg-grey-0 transition-transform dark:bg-on-solid",
                enabled && "translate-x-5",
              )}
            />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-meta font-medium">How often</span>
          <Segmented
            value={frequency}
            onChange={(v) => {
              setFrequency(v);
              void saveSchedule({ frequency: v });
            }}
            options={[
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
              { value: "monthly", label: "Monthly" },
            ]}
          />
          {frequency === "weekly" && (
            <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Days">
              {MONDAY_FIRST.map((d) => {
                const on = days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const next = on ? days.filter((x) => x !== d) : [...days, d];
                      if (next.length === 0) return;
                      setDays(next);
                      void saveSchedule({ days: next });
                    }}
                    className="h-9 min-w-11 rounded-lg border border-stroke px-2.5 text-preview font-medium text-subtle-foreground hover:bg-muted aria-pressed:border-transparent aria-pressed:bg-selected aria-pressed:text-ink"
                  >
                    {dayNames[d]}
                  </button>
                );
              })}
            </div>
          )}
          {frequency === "monthly" && (
            <label className="mt-1 flex items-center gap-2 text-meta">
              On the
              <select
                value={dayOfMonth}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setDayOfMonth(n);
                  void saveSchedule({ dayOfMonth: n });
                }}
                aria-label="Day of the month"
                className="h-9 rounded-lg border bg-card px-2.5 text-body border-stroke-strong md:text-meta"
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                    {n > 28 ? " (or the last day)" : ""}
                  </option>
                ))}
              </select>
              of each month
            </label>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-meta font-medium">Time</span>
          <select
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              void saveSchedule({ time: e.target.value });
            }}
            aria-label="Time"
            className="h-9 w-full rounded-lg border bg-card px-2.5 text-body border-stroke-strong sm:w-auto sm:min-w-40 sm:self-start md:text-meta"
          >
            {times.map((t) => (
              <option key={t} value={t}>
                {timeLabel(t)}
                {checkIns.times.includes(t) ? "" : "(not a check-in time)"}
              </option>
            ))}
          </select>
          <span className="text-meta text-muted-foreground">
            Claude checks in at {checkInsLabel(checkIns)}, and does whatever&apos;s due. If a check-in doesn&apos;t happen,
            that run is skipped.
            {offDays.length > 0 &&
              `${offDays.map((d) => dayNames[d]).join("and ")} ${offDays.length === 1 ? "isn't a check-in day": "aren't check-in days"}, so ${offDays.length === 1 ? "that run happens": "those runs happen"} at the next check-in.`}
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-meta font-medium">Follow an SOP</span>
          <select
            value={sopId ?? ""}
            onChange={(e) => {
              const next = e.target.value || null;
              setSopId(next);
              queue({ sopId: next }, 0);
            }}
            aria-label="SOP"
            className="h-9 w-full rounded-lg border bg-card px-2.5 text-body border-stroke-strong sm:w-auto sm:min-w-56 sm:self-start md:text-meta"
          >
            <option value="">None</option>
            {sops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || "Untitled SOP"}
              </option>
            ))}
          </select>
          {sopId && (
            <Link href={`/agents/sops/${sopId}`} className="self-start text-meta text-muted-foreground underline-offset-2 hover:underline">
              Open this SOP
            </Link>
          )}
        </label>
      </div>

      <h2 className="mt-2 text-meta font-medium text-muted-foreground">Instructions</h2>
      <Toolbar editor={editor} />

      <div className="min-h-[30dvh] cursor-text pb-6" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
