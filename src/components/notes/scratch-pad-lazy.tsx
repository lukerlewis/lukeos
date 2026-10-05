"use client";

import { lazy, Suspense, useSyncExternalStore } from "react";

// The editor is most of the home screen's code, so it loads just after the
// screen appears instead of holding it up.
const Editor = lazy(() => import("./scratch-pad").then((m) => ({ default: m.ScratchPad })));

const noSubscribe = () => () => {};

/** The dashboard's scratch pad, showing its text as a plain preview until the editor is ready. */
export function ScratchPad({ id, content }: { id: string; content: string }) {
  // Only load the editor in the browser; the server sends the preview.
  const inBrowser = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const preview = <Preview content={content} />;
  if (!inBrowser) return preview;
  return (
    <Suspense fallback={preview}>
      <Editor id={id} content={content} />
    </Suspense>
  );
}

/** Same spot and size as the editor, with the Markdown marks left out. */
function Preview({ content }: { content: string }) {
  const text = content
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+|>\s?)/, "")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__|~~|`)/g, ""),
    )
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return (
    <div className="flex flex-col gap-2 p-4" aria-busy="true">
      <div className="note-body max-h-[50dvh] min-h-28 overflow-y-auto text-body! whitespace-pre-wrap md:text-preview!">
        {text ? text : <span className="text-muted-foreground">Jot things down. Type @claude to ask Claude to do something.</span>}
      </div>
      <span className="text-right text-meta text-muted-foreground">Saved</span>
    </div>
  );
}
