"use client";

import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { ClaudeTag } from "./claude-tag";
import { useAutosave } from "./note-editor";

/**
 * The dashboard's scratch pad: one running page, saved as you type. Type
 * @claude on a line to ask Claude something; the tag turns green once it's done.
 */
export function ScratchPad({ id, content }: { id: string; content: string }) {
  const { state, queue } = useAutosave(id);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Jot things down. Type @claude to ask Claude to do something." }),
      Markdown,
      ClaudeTag,
    ],
    content,
    contentType: "markdown",
    editorProps: { attributes: { class: "note-body min-h-28! text-[15px]! md:text-[14px]!", "aria-label": "Scratch pad" } },
    onUpdate: ({ editor }) => queue({ content: editor.getMarkdown() }),
  });

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="max-h-[50dvh] cursor-text overflow-y-auto" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}>
        <EditorContent editor={editor} />
      </div>
      <span className="text-right text-xs text-muted-foreground" aria-live="polite">
        {state === "saving" ? "Saving…" : state === "error" ? "Not saved yet, retrying" : "Saved"}
      </span>
    </div>
  );
}
