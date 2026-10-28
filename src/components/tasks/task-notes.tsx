"use client";

import { TaskItem, TaskList } from "@tiptap/extension-list";
import { ResizableImage } from "@/components/notes/resizable-image";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClaudeTag } from "@/components/notes/claude-tag";
import { imageFiles, Toolbar } from "@/components/notes/note-editor";
import { shrinkPhoto } from "@/components/notes/photos";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import { OpenLinks } from "@/components/notes/open-links";

/**
 * A task's notes, with the same formatting as notes: headings, lists,
 * checklists, links and photos. They're kept as Markdown.
 */
export function TaskNotes({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (markdown: string) => void;
  className?: string;
}) {
  const [uploading, setUploading] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const changeRef = useRef(onChange);
  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);

  // Photos pasted, dropped or picked are shrunk, saved, then placed in the notes.
  const addPhotos = useCallback((files: File[], editor: Editor, at?: number) => {
    for (const file of files) {
      setUploading((n) => n + 1);
      shrinkPhoto(file)
        .then((photo) => op("save_image", photo))
        .then((saved) => {
          const chain = editor.chain().focus();
          (at !== undefined ? chain.insertContentAt(at, { type: "image", attrs: { src: saved.url } }) : chain.setImage({ src: saved.url })).run();
        })
        .catch((err: Error) => alert(`Couldn't add that photo. ${err.message}`))
        .finally(() => setUploading((n) => n - 1));
    }
  }, []);

  const editorRef = useRef<Editor | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      ResizableImage,
      Placeholder.configure({ placeholder: "Add notes…" }),
      Markdown,
      OpenLinks,
      ClaudeTag,
    ],
    content: keepLineBreaks(value),
    contentType: "markdown",
    editorProps: {
      attributes: { class: "note-body", "aria-label": "Notes" },
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (!files.length || !editorRef.current) return false;
        addPhotos(files, editorRef.current);
        return true;
      },
      handleDrop: (view, event) => {
        const files = imageFiles(event.dataTransfer?.files);
        if (!files.length || !editorRef.current) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        addPhotos(files, editorRef.current, at);
        return true;
      },
    },
    onUpdate: ({ editor }) => changeRef.current(editor.isEmpty ? "" : editor.getMarkdown()),
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Toolbar editor={editor} onPhoto={() => fileInput.current?.click()} uploading={uploading > 0} />
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = imageFiles(e.target.files);
          if (files.length && editor) addPhotos(files, editor);
          e.target.value = "";
        }}
      />
      <div className="min-h-40 cursor-text pb-6" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/**
 * Notes written before tasks had formatting are plain text, where one line
 * break means a new line. In Markdown it would join the lines up, so those
 * become line breaks (lists, headings and quotes are left alone).
 */
function keepLineBreaks(text: string) {
  const block = /^\s*([-*+>#|]|\d+[.)])\s/;
  const lines = text.split("\n");
  return lines
    .map((line, i) => {
      const next = lines[i + 1];
      if (next === undefined || !line.trim() || !next.trim() || block.test(line) || block.test(next) || line.endsWith("  ")) return line;
      return `${line}  `;
    })
    .join("\n");
}
