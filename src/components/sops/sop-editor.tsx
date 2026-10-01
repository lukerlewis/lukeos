"use client";

import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Toolbar, useAutosave } from "@/components/notes/note-editor";
import { showTrashedToast } from "@/components/shell/toast";
import { MadeByLabel } from "@/components/tasks/made-by";
import { Button } from "@/components/ui/button";
import type { Sop } from "@/core/sops";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";

/** The longest description allowed (the same as Claude's own skills). */
const DESCRIPTION_MAX = 1024;
/** Past this, a description is costing Claude more than it needs to on every request. */
const DESCRIPTION_LONG = 300;
/** Roughly 500 lines: the point where splitting an SOP in two starts to pay off. */
const BODY_LONG_TOKENS = 5000;

const tokens = (text: string) => Math.ceil(text.trim().length / 4);
const roughly = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`);

export function SopEditor({ sop, autoFocus }: { sop: Sop; autoFocus?: boolean }) {
  const router = useRouter();
  const { state, queue, flush } = useAutosave(sop.id, "update_sop");
  const [title, setTitle] = useState(sop.title);
  const [description, setDescription] = useState(sop.description);
  const [bodyTokens, setBodyTokens] = useState(tokens(sop.body));
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // A new SOP left completely empty isn't worth keeping, so it's deleted for good when Luke leaves it.
  const hasText = useRef({ title: !!sop.title.trim(), description: !!sop.description.trim(), body: !!sop.body.trim() });
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const text = hasText.current;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current && !text.title && !text.description && !text.body)
          op("delete_sop", { id: sop.id })
            .then(() => op("delete_forever", { type: "sop", id: sop.id }))
            .catch(() => {});
      }, 0);
    };
  }, [sop.id]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({
        placeholder: "The steps, rules and examples Claude should follow...",
      }),
      Markdown,
    ],
    content: sop.body,
    contentType: "markdown",
    editorProps: { attributes: { class: "note-body", "aria-label": "Instructions" } },
    onUpdate: ({ editor }) => {
      const body = editor.getMarkdown();
      hasText.current.body = !editor.isEmpty;
      setBodyTokens(tokens(body));
      queue({ body });
    },
  });

  useEffect(() => {
    if (autoFocus) titleRef.current?.focus();
  }, [autoFocus]);

  async function remove() {
    await flush();
    try {
      await op("delete_sop", { id: sop.id });
      showTrashedToast("sop", sop.id, () => router.push(`/agents/sops/${sop.id}`));
      router.push("/agents?view=sops");
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const alwaysTokens = tokens(title) + tokens(description);
  const descriptionHint = !description.trim()
    ? "Add one so Claude knows when to use this SOP. Without it, Claude only has the title to go on."
    : description.length > DESCRIPTION_LONG
      ? "Claude reads this on every request, so shorter is better. Move detail into the instructions below."
      : "Say what it's for and when to use it, in the words you'd use when asking.";

  return (
    <div className="flex flex-col gap-3">
      <textarea
        ref={titleRef}
        value={title}
        rows={1}
        maxLength={200}
        onChange={(e) => {
          const next = e.target.value.replace(/\n/g, " ");
          setTitle(next);
          hasText.current.title = !!next.trim();
          queue({ title: next });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            document.getElementById("sop-description")?.focus();
          }
        }}
        placeholder="Untitled SOP"
        aria-label="Title"
        enterKeyHint="next"
        className="field-sizing-content resize-none bg-transparent text-[30px] leading-tight font-semibold tracking-tight outline-none placeholder:text-muted-foreground md:text-[28px]"
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <span>
          <MadeByLabel madeBy={sop.madeBy} createdAt={sop.createdAt} />
        </span>
        <span aria-live="polite" className={cn(state === "error" && "text-danger")}>
          {state === "saving" ? "Saving..." : state === "error" ? "Not saved yet, retrying" : "Saved"}
        </span>
        <span className="grow" />
        <Button variant="danger" size="sm" onClick={remove} className="-mr-2">
          <Trash2 className="size-4" aria-hidden />
          Delete
        </Button>
      </div>

      <label className="flex flex-col gap-1.5 rounded-xl border bg-card p-3 shadow-xs">
        <span className="flex items-baseline gap-2 text-[13px] font-medium">
          When to use it
          <span className="grow" />
          <span
            className={cn("text-xs font-normal text-muted-foreground", description.length > DESCRIPTION_LONG && "text-amber-700 dark:text-amber-400")}
          >
            {description.length}/{DESCRIPTION_MAX}
          </span>
        </span>
        <textarea
          id="sop-description"
          value={description}
          rows={2}
          maxLength={DESCRIPTION_MAX}
          onChange={(e) => {
            const next = e.target.value.replace(/\n+/g, " ");
            setDescription(next);
            hasText.current.description = !!next.trim();
            queue({ description: next });
          }}
          placeholder="e.g. How to write my weekly review. Use when I ask for a weekly review, week summary or Friday wrap-up."
          aria-label="Description: when to use it"
          className="field-sizing-content min-h-12 resize-none bg-transparent text-[15px] outline-none placeholder:text-muted-foreground md:text-sm"
        />
        <span className="text-xs text-muted-foreground">{descriptionHint}</span>
      </label>

      <p className="text-xs text-muted-foreground">
        Claude always sees the title and description (about {roughly(alwaysTokens)} tokens). It reads the instructions below
        only when a request fits (about {roughly(bodyTokens)} tokens).
        {bodyTokens > BODY_LONG_TOKENS && (
          <span className="text-amber-700 dark:text-amber-400">
            {" "}
            These are long. Consider moving detail Claude rarely needs into a separate SOP and naming it here, so Claude only
            reads it when it has to.
          </span>
        )}
      </p>

      <Toolbar editor={editor} />

      <div className="min-h-[40dvh] cursor-text pb-10" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
