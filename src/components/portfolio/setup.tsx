"use client";

import { useState } from "react";
import { CopyAddress } from "@/app/(app)/settings/claude";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";

/**
 * Connecting the site both ways: a key the site uses to send prompts here,
 * and the GitHub token Publish uses to write to the site's repo.
 */
export function PortfolioSetup({ hasKey, origin, canPublish, repo }: { hasKey: boolean; origin: string; canPublish: boolean; repo: string }) {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function make() {
    if (hasKey && !key && !confirm("Make a new key? The site stops sending prompts until it has the new one.")) return;
    setBusy(true);
    const res = await fetch("/api/portfolio/key", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return alert(body.error ?? "Couldn't make a key.");
    setKey(body.key);
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader title="Visitor prompts" aside={hasKey || key ? "Connected" : "Not connected"} />
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="text-meta text-muted-foreground">
            In the portfolio&apos;s Vercel project, under Settings &gt; Environment Variables, add LUKEOS_URL and LUKEOS_KEY with these, then redeploy. The key
            can only add prompts, and it&apos;s shown once.
          </p>
          <CopyAddress address={origin} label="Copy LUKEOS_URL" />
          {key ? (
            <CopyAddress address={key} label="Copy LUKEOS_KEY" />
          ) : (
            <Button variant="outline" size="sm" onClick={make} disabled={busy} className="self-start">
              {hasKey ? "Make a new key" : "Make the key"}
            </Button>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="Publishing" aside={canPublish ? "Ready" : "Not set up"} />
        <div className="flex flex-col gap-2 px-4 py-4 text-meta text-muted-foreground">
          {canPublish ? (
            <p>Publish commits to {repo} on GitHub, and the site redeploys from there.</p>
          ) : (
            <>
              <p>
                Publish needs a GitHub token that can write to {repo}. On GitHub, go to Settings &gt; Developer settings &gt; Fine-grained tokens, make one
                with access to only that repository and Contents set to Read and write.
              </p>
              <p>Then in LukeOS&apos;s Vercel project add it as PORTFOLIO_GITHUB_TOKEN and redeploy.</p>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
