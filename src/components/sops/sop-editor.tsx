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

/** The editor is shared by SOPs and context files, which work the same way. */
const kinds = {
  sop: {
    type: "sop",
    update: "update_sop",
    remove: "delete_sop",
    href: "/agents/sops",
    list: "/agents?view=sops",
    untitled: "Untitled SOP",
    label: "When to use it",
    ask: "When should Claude use this?",
    body: "Instructions…",
    long: "Long instructions. Consider splitting rarely needed detail into another SOP.",
  },
  context: {
    type: "context",
    update: "update_context",
    remove: "delete_context",
    href: "/agents/context",
    list: "/agents?view=context",
    untitled: "Untitled",
    label: "What it's about",
    ask: "When is this useful to Claude?",
    body: "Write the context…",
    long: "Long file. Consider splitting rarely needed detail into another context file.",
  },
} as const;
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";

/** The longest description allowed (the same as Claude's own skills). */
const DESCRIPTION_MAX = 1024;
/** Past this, a description is costing Claude more than it needs to on every request. */
const DESCRIPTION_LONG = 300;
/** Roughly 500 lines: the point where splitting an SOP in two starts to pay off. */
const BODY_LONG_TOKENS = 5000;

const tokens = (text: string) => Math.ceil(text.trim().length / 4);

export function SopEditor({ sop, autoFocus, kind = "sop" }: { sop: Sop; autoFocus?: boolean; kind?: keyof typeof kinds }) {
  const k = kinds[kind];
  const router = useRouter();
  const { state, queue, flush } = useAutosave(sop.id, k.update);
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
          op(k.remove, { id: sop.id })
            .then(() => op("delete_forever", { type: k.type, id: sop.id }))
            .catch(() => {});
      }, 0);
    };
  }, [sop.id, k]);

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
        placeholder: k.body,
      }),
      Markdown,
    ],
    content: sop.body,
    contentType: "markdown",
    editorProps: { attributes: { class: "note-body", "aria-label": k.body.replace("…", "") } },
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
      await op(k.remove, { id: sop.id });
      showTrashedToast(k.type, sop.id, () => router.push(`${k.href}/${sop.id}`));
      router.push(k.list);
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

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
        placeholder={k.untitled}
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
          {k.label}
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
          placeholder={k.ask}
          aria-label={`Description: ${k.label.toLowerCase()}`}
          className="field-sizing-content min-h-12 resize-none bg-transparent text-[16px] outline-none placeholder:text-muted-foreground md:text-sm"
        />
      </label>

      {bodyTokens > BODY_LONG_TOKENS && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{k.long}</p>
      )}

      <Toolbar editor={editor} />

      <div className="min-h-[40dvh] cursor-text pb-10" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
