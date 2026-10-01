"use client";

import { CalendarClock, CheckSquare, FileText, Folder, Globe, Package, RotateCcw, ScrollText, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { showToast } from "@/components/shell/toast";
import { ClaudeBadge } from "@/components/tasks/made-by";
import { Button } from "@/components/ui/button";
import type { TrashItem } from "@/core/trash";
import { daysBetween, dayAndMonth, todayIn } from "@/lib/dates";
import { op } from "@/lib/ops-client";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "Deleted today · gone in 30 days" */
function whenLabel(item: TrashItem, timeZone: string) {
  const today = todayIn(timeZone);
  const deleted = todayIn(timeZone, new Date(item.deletedAt));
  const left = Math.max(0, daysBetween(today, todayIn(timeZone, new Date(item.deletesOn))));
  const when = deleted === today ? "today" : `on ${dayAndMonth(deleted)}`;
  const gone = left <= 1 ? "gone tomorrow" : `gone in ${left} days`;
  return `Deleted ${when} · ${gone}`;
}

export function TrashList({ items, timeZone }: { items: TrashItem[]; timeZone: string }) {
  return (
    <ul>
      {items.map((item) => (
        <TrashRow key={`${item.type}-${item.id}`} item={item} timeZone={timeZone} />
      ))}
    </ul>
  );
}

function TrashRow({ item, timeZone }: { item: TrashItem; timeZone: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const Icon =
    item.type === "project"
      ? Folder
      : item.type === "task"
        ? CheckSquare
        : item.type === "artifact"
          ? Package
          : item.type === "sop"
            ? ScrollText
            : item.type === "routine"
              ? CalendarClock
              : item.format === "html"
                ? Globe
                : FileText;
  const kind = { project: "Project", task: "Task", note: "Note", artifact: "Artifact", sop: "SOP", routine: "Routine" }[item.type];
  const containsText =
    item.contains &&
    [
      item.contains.tasks && plural(item.contains.tasks, "task"),
      item.contains.notes && plural(item.contains.notes, "note"),
      item.contains.artifacts && plural(item.contains.artifacts, "artifact"),
    ].filter(Boolean);

  async function restore() {
    setBusy(true);
    try {
      const { movedOutOfProject } = await op("restore_from_trash", { type: item.type, id: item.id });
      showToast(
        movedOutOfProject
          ? `${kind} restored. Its project is still in Trash, so it's on its own now.`
          : `${kind} restored`,
      );
      router.refresh();
    } catch (err) {
      showToast((err as Error).message);
      setBusy(false);
    }
  }

  async function removeForever() {
    const extra =
      containsText && containsText.length > 0 ? ` and the ${containsText.join(" and ")} in it` : "";
    if (!confirm(`Delete "${item.title}"${extra} for good? This can't be undone.`)) return;
    setBusy(true);
    try {
      await op("delete_forever", { type: item.type, id: item.id });
      showToast(`${kind} deleted for good`);
      router.refresh();
    } catch (err) {
      showToast((err as Error).message);
      setBusy(false);
    }
  }

  const contains = containsText?.join(", ");

  return (
    <li className="flex flex-col gap-2 border-b px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 grow items-start gap-3">
        <Icon className="mt-0.5 size-[18px] shrink-0 text-muted-foreground md:size-4" aria-hidden />
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <span className="truncate text-[15px] font-medium md:text-sm">
            <span className="sr-only">{kind}: </span>
            {item.title}
          </span>
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
            <span>
              {whenLabel(item, timeZone)}
              {contains && ` · with ${contains}`}
            </span>
            {item.project && (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-[3px]" style={{ background: item.project.hex }} aria-hidden />
                {item.project.name}
                {item.project.inTrash && " (also in Trash)"}
              </span>
            )}
            <ClaudeBadge madeBy={item.madeBy} />
          </span>
        </div>
      </div>
      <div className="flex shrink-0 gap-1 pl-7 sm:pl-0">
        <Button variant="outline" size="sm" onClick={restore} disabled={busy}>
          <RotateCcw className="size-3.5" aria-hidden />
          Restore
        </Button>
        <Button variant="danger" size="sm" onClick={removeForever} disabled={busy} aria-label={`Delete "${item.title}" for good`}>
          <Trash2 className="size-3.5" aria-hidden />
          <span className="max-sm:sr-only">Delete for good</span>
        </Button>
      </div>
    </li>
  );
}

export function EmptyTrashButton({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function empty() {
    if (!confirm(`Delete everything in Trash (${plural(count, "item")}) for good? This can't be undone.`)) return;
    setBusy(true);
    try {
      await op("empty_trash", {});
      showToast("Trash emptied");
      router.refresh();
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={empty} disabled={busy}>
      <Trash2 className="size-3.5" aria-hidden />
      Empty Trash
    </Button>
  );
}
