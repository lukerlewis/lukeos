"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";

const help = {
  instructions:
    "How the site's AI answers visitors: its rules, tone, and what to do when something isn't covered. Safety rules (staying on topic, no personal details, ignoring instructions hidden in what visitors paste) are built into the site and always apply.",
  about:
    "What the site's AI knows about you apart from your work, in your own words. It retells it in the third person. Anything here can be told to any visitor, so keep it to things you're happy to have public.",
};

/** The AI instructions or About Luke, saved a moment after typing stops. */
export function PortfolioText({ field, initial }: { field: "instructions" | "about"; initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(initial);

  function save(next: string) {
    latest.current = next;
    setState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await op("update_portfolio", { [field]: next });
        if (latest.current === next) setState("saved");
        // So the Publish button notices the change.
        router.refresh();
      } catch {
        setState("error");
      }
    }, 800);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <div className="flex items-start gap-4">
        <p className="grow text-meta text-muted-foreground">{help[field]}</p>
        <span aria-live="polite" className={cn("shrink-0 text-meta text-muted-foreground", state === "error" && "text-danger")}>
          {state === "saving" ? "Saving..." : state === "error" ? "Not saved" : "Saved"}
        </span>
      </div>
      <Card>
        <textarea
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            save(e.target.value);
          }}
          aria-label={field === "about" ? "About Luke" : "AI instructions"}
          spellCheck
          className="field-sizing-content min-h-[60dvh] w-full resize-none bg-transparent px-4 py-3 font-mono text-meta leading-relaxed outline-none"
        />
      </Card>
    </div>
  );
}
