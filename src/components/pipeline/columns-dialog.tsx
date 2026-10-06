"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { PipelineColumn } from "@/core/pipeline";
import { op } from "@/lib/ops-client";

type Row = PipelineColumn & { count: number };

const field =
  "h-9 min-w-0 grow rounded-lg border bg-card px-2.5 text-body border-stroke-strong outline-none focus-visible:border-ring md:text-meta";

/** Add, rename, reorder and delete a pipeline's columns. Each change saves straight away. */
export function ColumnsDialog({ projectId, columns, onClose }: { projectId: string; columns: Row[]; onClose: () => void }) {
  const router = useRouter();
  const [rows, setRows] = useState(columns);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState("");
  // The column being deleted that still has cards, and where they'll go.
  const [removing, setRemoving] = useState<{ id: string; to: string } | null>(null);

  async function run(request: () => Promise<{ columns: (PipelineColumn & { cards: unknown[] })[] }>) {
    setBusy(true);
    try {
      const { columns: next } = await request();
      setRows(next.map(({ id, name, position, cards }) => ({ id, name, position, count: cards.length })));
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rename = (row: Row, name: string) => {
    const clean = name.trim();
    if (!clean || clean === row.name) return;
    void run(() => op("update_pipeline_column", { id: row.id, name: clean }));
  };
  const shift = (index: number, by: number) =>
    run(() => op("update_pipeline_column", { id: rows[index].id, position: index + by }));
  const remove = (row: Row, moveCardsTo?: string) =>
    run(async () => {
      const out = await op("delete_pipeline_column", { id: row.id, moveCardsTo });
      setRemoving(null);
      return out;
    });
  const add = () => {
    const name = adding.trim();
    if (!name) return;
    setAdding("");
    void run(() => op("add_pipeline_column", { projectId, name }));
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
          <li key={row.id} className="flex flex-col gap-2">
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
              <Button variant="ghost" size="icon" onClick={() => shift(i, -1)} disabled={busy || i === 0} aria-label={`Move ${row.name} earlier`}>
                <ArrowUp className="size-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => shift(i, 1)}
                disabled={busy || i === rows.length - 1}
                aria-label={`Move ${row.name} later`}
              >
                <ArrowDown className="size-4" aria-hidden />
              </Button>
              <Button
                variant="danger"
                size="icon"
                disabled={busy || (row.count > 0 && rows.length === 1)}
                aria-label={`Delete ${row.name}`}
                onClick={() => {
                  if (row.count === 0) {
                    if (confirm(`Delete the "${row.name}" column?`)) void remove(row);
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
                <Button size="sm" onClick={() => remove(row, removing.to)} disabled={busy}>
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
        <Button type="submit" variant="outline" disabled={busy || !adding.trim()}>
          <Plus className="size-4" aria-hidden />
          Add
        </Button>
      </form>
    </Dialog>
  );
}
