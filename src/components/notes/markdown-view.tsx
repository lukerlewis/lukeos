"use client";

import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";

/** Markdown shown the way notes look, but read only (for artifacts). Links open in a new tab. */
export function MarkdownView({ content }: { content: string }) {
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: false,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: true, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Image,
        TableKit.configure({ table: { resizable: false } }),
        Markdown,
      ],
      content,
      contentType: "markdown",
      editorProps: { attributes: { class: "note-body min-h-0!", "aria-label": "Artifact text" } },
    },
    [content],
  );
  return <EditorContent editor={editor} />;
}
