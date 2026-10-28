"use client";

import { Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Pins a note or document to the row of cards above its list, or unpins it. */
export function PinButton({ pinned, onChange }: { pinned: boolean; onChange: (pinned: boolean) => void }) {
  const Icon = pinned ? PinOff : Pin;
  return (
    <Button variant="ghost" size="sm" onClick={() => onChange(!pinned)} aria-pressed={pinned}>
      <Icon className="size-4" aria-hidden />
      {pinned ? "Unpin" : "Pin"}
    </Button>
  );
}
