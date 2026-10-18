import { Flame, Headphones, Sailboat, Target } from "lucide-react";
import { effortLabel, priorityFlames, priorityLabel, type Effort, type Priority } from "@/lib/task-fields";
import { cn } from "@/lib/utils";

const effortIcon = { shallow: Sailboat, focus: Target, deep: Headphones } as const;

/** A focus type as a small grey label with its icon: Shallow (boat), Focus, Deep work (headphones). */
export function FocusChip({ effort, className }: { effort: Effort; className?: string }) {
  const Icon = effortIcon[effort];
  return (
    <span className={cn("tag", className)}>
      <Icon className="size-3" aria-hidden />
      {effortLabel[effort]}
    </span>
  );
}

export function FocusIcon({ effort, className }: { effort: Effort; className?: string }) {
  const Icon = effortIcon[effort];
  return <Icon className={className} aria-hidden />;
}

/** A priority as one, two or three outlined flames on a green, yellow or red tint. */
export function PriorityChip({ priority, className }: { priority: Priority; className?: string }) {
  return (
    <span className={cn("flames", `flames-${priority}`, className)} title={`${priorityLabel[priority]} priority`}>
      {Array.from({ length: priorityFlames[priority] }, (_, i) => (
        <Flame key={i} className="size-3.5" aria-hidden />
      ))}
      <span className="sr-only">{priorityLabel[priority]} priority</span>
    </span>
  );
}
