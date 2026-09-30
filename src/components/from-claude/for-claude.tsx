"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "@/components/shell/page";
import { showToast } from "@/components/shell/toast";
import { Button } from "@/components/ui/button";
import type { Mention } from "@/core/mentions";
import { op } from "@/lib/ops-client";
import { Words } from "./mention-list";

/** The box for asking Claude something, shared by the dashboard card and the Add new menu. */
export function AskClaudeForm({ onDone, autoFocus }: { onDone?: () => void; autoFocus?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const clean = text.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      await op("ask_claude", { text: clean });
      setText("");
      showToast("Left for Claude");
      router.refresh();
      onDone?.();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder="Ask Claude to do something, or leave it a note…"
        aria-label="Request for Claude"
        rows={3}
        className="field-sizing-content max-h-60 min-h-20 w-full resize-none rounded-lg border bg-background px-3 py-2 text-[14px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40 md:text-[13px]"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Claude picks it up the next time it runs.</span>
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}

/**
 * The dashboard's "For Claude" card: leave a request or a note, and see
 * what's still waiting (from anywhere you wrote @claude) and what Claude
 * last did.
 */
export function ForClaude({ open, done, when }: { open: Mention[]; done: Mention[]; when: Record<string, string> }) {
  return (
    <>
      <div className="p-4">
        <AskClaudeForm />
      </div>
      {open.length > 0 && (
        <div className="border-t">
          <h3 className="bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">Waiting for Claude · {open.length}</h3>
          <ul>
            {open.slice(0, 5).map((m) => (
              <li key={m.id} className="border-t first:border-t-0">
                <Link href={`/agents?view=claude#${m.id}`} className="flex flex-col gap-0.5 px-4 py-2 hover:bg-muted/50">
                  <span className="line-clamp-2">
                    <Words text={m.text} done={false} />
                  </span>
                  <span className="text-xs text-muted-foreground">{when[m.id]}</span>
                </Link>
              </li>
            ))}
          </ul>
          {open.length > 5 && (
            <Link href="/agents?view=claude" className="block border-t px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
              {open.length - 5} more
            </Link>
          )}
        </div>
      )}
      {done.length > 0 && (
        <div className="border-t">
          <h3 className="bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">Recently done</h3>
          <ul>
            {done.map((m) => (
              <li key={m.id} className="border-t first:border-t-0">
                <Link href={`/agents?view=claude#${m.id}`} className="flex flex-col gap-1 px-4 py-2 hover:bg-muted/50">
                  <span className="line-clamp-2 text-muted-foreground">
                    <Words text={m.text} done />
                  </span>
                  {m.reply && (
                    <span className="flex gap-1.5 text-xs">
                      <Sparkles className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="line-clamp-2">{m.reply}</span>
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {open.length === 0 && done.length === 0 && (
        <EmptyState>You can also type @claude in any note, task or comment.</EmptyState>
      )}
    </>
  );
}
