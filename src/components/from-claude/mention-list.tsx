"use client";

import { Check, CheckSquare, FileText, MessageSquare, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { useTaskEditor } from "@/components/tasks/task-editor";
import { Button } from "@/components/ui/button";
import type { Mention } from "@/core/mentions";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";

/** The line Luke wrote, with each "@claude" shown as a tag. */
function Words({ text, done }: { text: string; done: boolean }) {
  const parts = text.split(/(@claude\b)/i);
  return (
    <span className="text-[15px] break-words md:text-sm">
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className={cn("claude-tag", done && "is-done")}>
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </span>
  );
}

/** Every @claude request, open ones first. Luke can mark one done himself, or open it again. */
export function MentionList({ mentions, when }: { mentions: Mention[]; when: Record<string, string> }) {
  const open = mentions.filter((m) => m.status === "open");
  const done = mentions.filter((m) => m.status === "done");
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-sm font-semibold">
          Waiting for Claude <span className="font-normal text-muted-foreground">{open.length}</span>
        </h2>
        <ul className="overflow-hidden rounded-xl border bg-card shadow-xs">
          {open.length === 0 ? (
            <li className="px-4 py-6 text-center text-[13px] text-muted-foreground">
              Nothing waiting. Type @claude in a note, a task or a comment to ask Claude something.
            </li>
          ) : (
            open.map((m) => <Row key={m.id} mention={m} when={when[m.id]} />)
          )}
        </ul>
      </section>
      {done.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold">
            Done <span className="font-normal text-muted-foreground">{done.length}</span>
          </h2>
          <ul className="overflow-hidden rounded-xl border bg-card shadow-xs">
            {done.map((m) => (
              <Row key={m.id} mention={m} when={when[m.id]} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({ mention: m, when }: { mention: Mention; when: string }) {
  const router = useRouter();
  const { openTask } = useTaskEditor();
  const [busy, setBusy] = useState(false);
  const done = m.status === "done";

  async function setDone(resolved: boolean) {
    setBusy(true);
    try {
      await op("resolve_mention", { id: m.id, resolved });
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const Icon = m.where.type === "task" ? CheckSquare : m.where.type === "comment" ? MessageSquare : FileText;
  const place =
    m.where.type === "comment" && m.where.on
      ? { label: `Comment on ${m.where.on.title || "Untitled"}`, href: `/${m.where.on.type}s/${m.where.on.id}` }
      : m.where.type === "note"
        ? { label: m.where.title || "Untitled note", href: `/notes/${m.where.id}` }
        : { label: m.where.title || "Task", href: null };

  return (
    <li id={m.id} className="flex flex-col gap-2 border-b px-4 py-3 last:border-b-0 target:bg-muted/60">
      <Words text={m.text} done={done} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {place.href ? (
          <Link href={place.href} className="inline-flex min-w-0 items-center gap-1.5 hover:text-foreground">
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{place.label}</span>
          </Link>
        ) : (
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1.5 hover:text-foreground"
            onClick={async () => {
              try {
                openTask(await op("get_task", { id: m.where.id }));
              } catch (err) {
                alert((err as Error).message);
              }
            }}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{place.label}</span>
          </button>
        )}
        <span>{when}</span>
        {m.removed && <span>Tag since removed</span>}
        <span className="grow" />
        <Button variant="ghost" size="sm" className="-mr-2" disabled={busy} onClick={() => setDone(!done)}>
          {done ? <RotateCcw className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          {done ? "Reopen" : "Mark done"}
        </Button>
      </div>
      {done && (m.reply || m.resolvedBy) && (
        <p className="flex gap-2 rounded-lg bg-muted px-3 py-2 text-[13px]">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            <span className="font-medium">{m.resolvedBy ?? "You"}:</span> {m.reply ?? "Marked done."}
          </span>
        </p>
      )}
    </li>
  );
}
