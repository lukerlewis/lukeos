"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { showToast } from "@/components/shell/toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { PipelineColumn } from "@/core/pipeline";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";

type Row = PipelineColumn & { count: number };

const field =
  "h-9 min-w-0 grow rounded-lg border bg-card px-2.5 text-body border-stroke-strong outline-none focus-visible:border-ring md:text-meta";

/** Add, rename, reorder and delete a pipeline's columns. Each change saves straight away. */
export function ColumnsDialog({ projectId, columns, onClose }: { projectId: string; columns: Row[]; onClose: () => void }) {
  const router = useRouter();
  const [rows, setRows] = useState(columns);
  // Changes show at once and save one after another behind the scenes.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const waiting = useRef(0);
  const [adding, setAdding] = useState("");
  // The column being deleted that still has cards, and where they'll go.
  const [removing, setRemoving] = useState<{ id: string; to: string } | null>(null);

  type Columns = { columns: (PipelineColumn & { cards: unknown[] })[] };
  const fromServer = ({ columns: next }: Columns) =>
    setRows(next.map(({ id, name, position, cards }) => ({ id, name, position, count: cards.length })));

  function run(local: (rows: Row[]) => Row[], request: () => Promise<Columns>) {
    setRows(local);
    waiting.current++;
    queue.current = queue.current.then(async () => {
      try {
        const out = await request();
        // Only the last change's answer is shown, so a quick run of moves doesn't flicker.
        if (waiting.current === 1) fromServer(out);
      } catch (err) {
        showToast((err as Error).message);
        await op("get_pipeline", { projectId }).then(fromServer, () => {});
      } finally {
        waiting.current--;
        router.refresh();
      }
    });
  }

  const rename = (row: Row, name: string) => {
    const clean = name.trim();
    if (!clean || clean === row.name) return;
    run((rs) => rs.map((r) => (r.id === row.id ? { ...r, name: clean } : r)), () => op("update_pipeline_column", { id: row.id, name: clean }));
  };
  const shift = (index: number, by: number) =>
    run(
      (rs) => {
        const next = [...rs];
        [next[index], next[index + by]] = [next[index + by], next[index]];
        return next;
      },
      () => op("update_pipeline_column", { id: rows[index].id, position: index + by }),
    );
  const remove = (row: Row, moveCardsTo?: string) => {
    setRemoving(null);
    run(
      (rs) => rs.filter((r) => r.id !== row.id).map((r) => (r.id === moveCardsTo ? { ...r, count: r.count + row.count } : r)),
      () => op("delete_pipeline_column", { id: row.id, moveCardsTo }),
    );
  };
  const add = () => {
    const name = adding.trim();
    if (!name) return;
    setAdding("");
    run(
      (rs) => [...rs, { id: `pending-${Date.now()}`, name, position: rs.length, count: 0 } as Row],
      () => op("add_pipeline_column", { projectId, name }),
    );
  };

  return (
    <Dialog label="Pipeline columns" onClose={onClose} focusFirstField={false}>
      <div className="flex items-center gap-2 px-5 pt-4">
        <h2 className="grow text-lg font-medium">Columns</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="-mr-2">
          <X className="size-5" aria-hidden />
        </Button>
      </div>

      <ul className="flex flex-col gap-2 px-5 py-4">
        {rows.map((row, i) => (
          <li key={row.id} className={cn("flex flex-col gap-2", row.id.startsWith("pending-") && "pointer-events-none opacity-60")}>
            <div className="flex items-center gap-1.5">
              <input
                defaultValue={row.name}
                key={row.name}
                aria-label={`Name of column ${i + 1}`}
                onBlur={(e) => rename(row, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className={field}
              />
              <span className="w-8 shrink-0 text-center text-meta text-muted-foreground" title="Cards in it">
                {row.count}
              </span>
              <Button variant="ghost" size="icon" onClick={() => shift(i, -1)} disabled={i === 0} aria-label={`Move ${row.name} earlier`}>
                <ArrowUp className="size-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => shift(i, 1)}
                disabled={i === rows.length - 1}
                aria-label={`Move ${row.name} later`}
              >
                <ArrowDown className="size-4" aria-hidden />
              </Button>
              <Button
                variant="danger"
                size="icon"
                disabled={row.count > 0 && rows.length === 1}
                aria-label={`Delete ${row.name}`}
                onClick={() => {
                  if (row.count === 0) {
                    if (confirm(`Delete the "${row.name}" column?`)) remove(row);
                  } else setRemoving({ id: row.id, to: rows.find((r) => r.id !== row.id)!.id });
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
            {removing?.id === row.id && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-2.5 text-meta">
                <span>
                  Move its {row.count} {row.count === 1 ? "card" : "cards"} to
                </span>
                <select
                  value={removing.to}
                  onChange={(e) => setRemoving({ id: row.id, to: e.target.value })}
                  aria-label="Move its cards to"
                  className="h-9 rounded-lg border bg-card px-2.5 text-body border-stroke-strong md:text-meta"
                >
                  {rows
                    .filter((r) => r.id !== row.id)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
                <div className="grow" />
                <Button variant="outline" size="sm" onClick={() => setRemoving(null)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => remove(row, removing.to)}>
                  Delete column
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex items-center gap-2 border-t px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
      >
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="New column" aria-label="New column" className={field} />
        <Button type="submit" variant="outline" disabled={!adding.trim()}>
          <Plus className="size-4" aria-hidden />
          Add
        </Button>
      </form>
    </Dialog>
  );
}
