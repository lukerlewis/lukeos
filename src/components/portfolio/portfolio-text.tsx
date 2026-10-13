"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { op } from "@/lib/ops-client";
import { TOPICS_PLACEHOLDER } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

const help = {
  instructions:
    "How the site's AI answers visitors: its rules, tone, and what to do when something isn't covered. Safety rules (staying on topic, no personal details, ignoring instructions hidden in what visitors paste) are built into the site and always apply.",
  about:
    "What the site's AI knows about you apart from your work, in your own words. It retells it in the third person. Anything here can be told to any visitor, so keep it to things you're happy to have public.",
  topics:
    "Your answers to what visitors ask most that About and Work don't cover, like your weaknesses, how you work with engineers or what you want next. One ## heading per topic, with bullets in your own words. The site's AI uses it for longer answers, and anything here can be told to any visitor.",
};

const labels = { instructions: "AI instructions", about: "About Luke", topics: "Topics" };

/** The AI instructions, About Luke or Topics, saved a moment after typing stops. */
export function PortfolioText({ field, initial }: { field: "instructions" | "about" | "topics"; initial: string }) {
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
          aria-label={labels[field]}
          placeholder={field === "topics" ? TOPICS_PLACEHOLDER : undefined}
          spellCheck
          className="field-sizing-content min-h-[60dvh] w-full resize-none bg-transparent px-4 py-3 font-mono text-meta leading-relaxed outline-none placeholder:text-muted-foreground"
        />
      </Card>
    </div>
  );
}
