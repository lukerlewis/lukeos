"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { showToast } from "@/components/shell/toast";
import { Button } from "@/components/ui/button";
import type { portfolioStatus } from "@/core/portfolio";
import { op } from "@/lib/ops-client";

type Status = Awaited<ReturnType<typeof portfolioStatus>>;

const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/**
 * Sends the AI instructions, About Luke and the work on the portfolio to the
 * site's repo, which redeploys the live site. Says when it last went out and
 * whether anything has changed since.
 */
export function PublishButton({ status }: { status: Status }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function publish() {
    if (status.problems.length) return alert(`Fix these first:\n\n${status.problems.join("\n")}`);
    if (!status.canPublish) return alert("Publishing isn't set up yet. See Setup.");
    if (!confirm("Publish to the live portfolio? The site redeploys in about a minute.")) return;
    setBusy(true);
    try {
      const result = await op("publish_portfolio", {});
      showToast(result.changed ? "Published. The site updates in about a minute." : "The site is already up to date.");
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const note = status.unpublishedChanges
    ? status.lastPublished
      ? "Unpublished changes"
      : "Never published"
    : status.lastPublished && `Published ${when(status.lastPublished.at)}`;

  return (
    <div className="flex items-center gap-3">
      {note && (
        <span className="text-meta text-muted-foreground max-sm:hidden">
          {status.lastPublished?.commitUrl && !status.unpublishedChanges ? (
            <a href={status.lastPublished.commitUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
              {note}
            </a>
          ) : (
            note
          )}
        </span>
      )}
      <Button size="sm" onClick={publish} disabled={busy} variant={status.unpublishedChanges ? "primary" : "outline"}>
        <Upload aria-hidden />
        {busy ? "Publishing..." : "Publish"}
      </Button>
    </div>
  );
}
