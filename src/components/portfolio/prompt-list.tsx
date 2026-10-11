import Link from "next/link";
import { Search } from "lucide-react";
import { EmptyState } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import type { VisitorPrompt } from "@/core/portfolio";

/** What visitors asked the portfolio's AI, newest first, with what it answered. */
export function PromptList({
  prompts,
  total,
  search,
  timeZone,
  connected,
}: {
  prompts: VisitorPrompt[];
  total: number;
  search?: string;
  timeZone: string;
  connected: boolean;
}) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <form action="/portfolio" className="flex items-center gap-2 rounded-lg border bg-card px-3 border-stroke">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          name="q"
          defaultValue={search}
          placeholder={`Search ${total} ${total === 1 ? "prompt" : "prompts"}`}
          aria-label="Search visitor prompts"
          className="h-10 min-w-0 grow bg-transparent text-body outline-none md:text-sm"
        />
      </form>
      {prompts.length === 0 ? (
        <Card>
          <EmptyState>
            {search ? (
              "Nothing matches that."
            ) : connected ? (
              "No one has asked anything yet."
            ) : (
              <>
                The site isn&apos;t sending prompts yet. Connect it in{" "}
                <Link href="/portfolio?tab=setup" className="underline underline-offset-2">
                  Setup
                </Link>
                .
              </>
            )}
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <ul>
            {prompts.map((p) => (
              <li key={p.id} className="border-b last:border-b-0">
                <details className="group px-4 py-3">
                  <summary className="flex cursor-pointer list-none flex-col gap-1">
                    <span className="text-meta text-muted-foreground">
                      {fmt.format(p.createdAt)}
                      {p.kind === "fit" ? " · Role fit check" : p.tab ? ` · ${p.tab[0].toUpperCase()}${p.tab.slice(1)}` : ""}
                    </span>
                    <span className="line-clamp-3 font-medium whitespace-pre-wrap group-open:line-clamp-none">{p.question}</span>
                  </summary>
                  {p.reply && <p className="mt-2 border-l-2 pl-3 text-body whitespace-pre-wrap text-muted-foreground md:text-sm">{p.reply}</p>}
                  {p.settings && p.settings !== "{}" && <p className="mt-2 text-meta text-muted-foreground">Settings: {settingsText(p.settings)}</p>}
                </details>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** {"appearance":"dark","tone":"Gen Z"} -> "appearance dark, tone Gen Z". */
function settingsText(raw: string) {
  try {
    return Object.entries(JSON.parse(raw) as Record<string, unknown>)
      .filter(([, v]) => v !== "" && v != null)
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(", ");
  } catch {
    return raw;
  }
}
