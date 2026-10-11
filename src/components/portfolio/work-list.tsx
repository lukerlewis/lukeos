"use client";

import { ArrowDown, ArrowUp, ExternalLink, Lock, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import type { PortfolioEntry } from "@/core/portfolio";
import { listOf } from "@/lib/portfolio";
import { stageLabel, type EntryStage } from "@/lib/archive";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";

/**
 * Which Work archive entries the portfolio shows, in what order, and what it
 * says about each. The entry's story stays in LukeOS; the site only gets
 * these fields.
 */
export function PortfolioWorkList({ entries }: { entries: PortfolioEntry[] }) {
  const router = useRouter();
  const shown = entries.filter((e) => e.onPortfolio);
  const rest = entries.filter((e) => !e.onPortfolio);

  async function toggle(e: PortfolioEntry, on: boolean) {
    try {
      await op("update_portfolio_work", { id: e.id, onPortfolio: on });
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function move(i: number, by: -1 | 1) {
    const ids = shown.map((e) => e.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    await op("reorder_portfolio_work", { ids });
    router.refresh();
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-meta text-muted-foreground">
        Each piece of work is a Work archive entry. The site shows its card and button, and its AI tells visitors only what&apos;s under What the AI knows.
        The story stays here.
      </p>
      <section className="flex flex-col gap-3">
        <h2 className="text-heading font-medium">On the portfolio</h2>
        {shown.length === 0 && (
          <Card>
            <EmptyState>Nothing yet. Add work from the list below.</EmptyState>
          </Card>
        )}
        {shown.map((e, i) => (
          <WorkCard
            key={e.id}
            entry={e}
            first={i === 0}
            last={i === shown.length - 1}
            onMove={(by) => move(i, by)}
            onRemove={() => toggle(e, false)}
          />
        ))}
      </section>
      {rest.length > 0 && (
        <Card>
          <CardHeader title="Not on the portfolio" aside={`${rest.length}`} />
          <ul>
            {rest.map((e) => (
              <li key={e.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
                <Link href={`/archive/${e.id}`} className="flex min-w-0 grow flex-col gap-0.5">
                  <span className="truncate font-medium">{e.title || "Untitled"}</span>
                  <span className="text-meta text-muted-foreground">{stageLabel[e.stage as EntryStage] ?? e.stage}</span>
                </Link>
                {e.confidential ? (
                  <span className="inline-flex items-center gap-1.5 text-meta text-muted-foreground">
                    <Lock className="size-3.5" aria-hidden />
                    Confidential
                  </span>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => toggle(e, true)}>
                    <Plus aria-hidden />
                    Add
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

type Fields = { cardTitle: string; short: string; summary: string; kind: string; year: string; facts: string };

function WorkCard({
  entry,
  first,
  last,
  onMove,
  onRemove,
}: {
  entry: PortfolioEntry;
  first: boolean;
  last: boolean;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<Fields>({
    cardTitle: entry.cardTitle ?? "",
    short: entry.short ?? "",
    summary: entry.summary ?? "",
    kind: entry.kind ?? "",
    year: entry.year ?? "",
    facts: entry.facts,
  });
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const pending = useRef<Partial<Fields>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function change(key: keyof Fields, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    pending.current[key] = value;
    setState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const next = pending.current;
      pending.current = {};
      try {
        await op("update_portfolio_work", { id: entry.id, ...next });
        setState(Object.keys(pending.current).length ? "saving" : "saved");
        router.refresh();
      } catch {
        pending.current = { ...next, ...pending.current };
        setState("error");
      }
    }, 800);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  const input = (key: Exclude<keyof Fields, "facts">, label: string, placeholder: string, wide = false) => (
    <label className={cn("flex min-w-0 flex-col gap-0.5 px-3 py-2", wide && "col-span-3 border-t first:border-t-0", !wide && "border-t")}>
      <span className="text-meta text-muted-foreground">{label}</span>
      <input
        value={fields[key]}
        maxLength={300}
        placeholder={placeholder}
        onChange={(e) => change(key, e.target.value)}
        className="min-w-0 bg-transparent text-body outline-none placeholder:text-disabled md:text-sm"
      />
    </label>
  );

  return (
    <Card>
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <Link href={`/archive/${entry.id}`} className="inline-flex min-w-0 grow items-center gap-1.5 font-medium hover:underline">
          <span className="truncate">{entry.title || "Untitled"}</span>
          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
        <span aria-live="polite" className={cn("text-meta text-muted-foreground", state === "error" && "text-danger")}>
          {state === "saving" ? "Saving..." : state === "error" ? "Not saved" : ""}
        </span>
        <Button variant="ghost" size="sm" onClick={() => onMove(-1)} disabled={first} aria-label="Move up">
          <ArrowUp aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onMove(1)} disabled={last} aria-label="Move down">
          <ArrowDown aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove} className="-mr-2">
          <Minus aria-hidden />
          Remove
        </Button>
      </div>
      <div className="grid grid-cols-3 [&>label:not(.col-span-3)+label:not(.col-span-3)]:border-l">
        {input("cardTitle", "Title on the site", entry.title || "Title", true)}
        {input("short", "Button name", fields.cardTitle || entry.title || "Short name")}
        {input("kind", "Kind", "e.g. Shipped app")}
        {input("year", "Year", "e.g. 2026")}
        {input("summary", "Summary", "One sentence for its card", true)}
      </div>
      <label className="flex flex-col gap-0.5 border-t px-3 py-2">
        <span className="text-meta text-muted-foreground">What the AI knows</span>
        <textarea
          value={fields.facts}
          onChange={(e) => change("facts", e.target.value)}
          placeholder="- What it is, why you made it, what you did and what happened, in your words."
          className="field-sizing-content min-h-24 resize-none bg-transparent font-mono text-meta leading-relaxed outline-none placeholder:text-disabled"
        />
      </label>
      {entry.missing.length > 0 && (
        <p className="border-t px-4 py-2 text-meta text-danger">Needs {listOf(entry.missing)} before it can be published.</p>
      )}
    </Card>
  );
}
