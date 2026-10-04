"use client";

import { CalendarDays, List, Repeat, X } from "lucide-react";
import { useState } from "react";
import { friendlyDay } from "@/lib/dates";
import { parseTaskText, type SmartEntry, type SmartMatch } from "@/lib/smart-entry";
import { bucketLabel, repeatLabel, type Repeat as RepeatValue } from "@/lib/task-fields";
import { cn } from "@/lib/utils";

/**
 * Reads dates, repeats and lists out of a new task's name as it's typed. Tapping a
 * chip's × puts those words back as plain words.
 */
export function useSmartEntry(text: string, today: string, enabled = true) {
  const [ignore, setIgnore] = useState<ReadonlySet<string>>(() => new Set());
  const parsed: SmartEntry = enabled
    ? parseTaskText(text, today, ignore)
    : { title: text.trim(), dueDate: null, repeat: null, bucket: null, matches: [] };

  function dismiss(kind: SmartMatch["kind"]) {
    const match = parsed.matches.find((m) => m.kind === kind);
    if (match) setIgnore((s) => new Set(s).add(match.text.toLowerCase()));
  }

  return { parsed, dismiss, reset: () => setIgnore(new Set()) };
}

/** The date, repeat and list picked up from the name, each as a chip with a × to undo it. */
export function SmartChips({
  parsed,
  dueDate,
  repeat,
  today,
  onDismiss,
  className,
}: {
  parsed: SmartEntry;
  /** The due date the task will get, which a repeat without its own day borrows. */
  dueDate: string | null;
  repeat: RepeatValue | null;
  today: string;
  onDismiss: (kind: SmartMatch["kind"]) => void;
  className?: string;
}) {
  if (!parsed.matches.length) return null;
  const has = (kind: SmartMatch["kind"]) => parsed.matches.some((m) => m.kind === kind);
  // "every monday" sets a day as well as a repeat, so it shows both.
  const showDate = dueDate && (has("date") || (has("repeat") && parsed.dueDate));

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {showDate && (
        <Chip icon={CalendarDays} label={friendlyDay(dueDate, today)} onDismiss={() => onDismiss(has("date") ? "date" : "repeat")} />
      )}
      {has("repeat") && repeat && <Chip icon={Repeat} label={repeatLabel[repeat]} onDismiss={() => onDismiss("repeat")} />}
      {parsed.bucket && <Chip icon={List} label={bucketLabel[parsed.bucket]} onDismiss={() => onDismiss("list")} />}
    </div>
  );
}

function Chip({ icon: Icon, label, onDismiss }: { icon: typeof Repeat; label: string; onDismiss: () => void }) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-label={`${label}. Tap to keep these words in the name instead`}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-doing/12 pr-1.5 pl-2.5 text-[13px] font-medium whitespace-nowrap text-doing"
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
      <X className="size-3.5 opacity-70" aria-hidden />
    </button>
  );
}

/** The name as typed, with the words that set a date, repeat or list picked out. Sits under a see-through text box. */
export function HighlightedText({ text, matches }: { text: string; matches: SmartMatch[] }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const m of matches) {
    parts.push(text.slice(at, m.start));
    parts.push(
      <mark key={m.start} className="rounded-sm bg-doing/12 text-doing">
        {text.slice(m.start, m.end)}
      </mark>,
    );
    at = m.end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
