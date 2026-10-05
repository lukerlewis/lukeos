"use client";

import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  Bold,
  Download,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Minus,
  Quote,
  Strikethrough,
  Table,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { imageFiles, useAutosave } from "@/components/notes/note-editor";
import { shrinkPhoto } from "@/components/notes/photos";
import { showTrashedToast } from "@/components/shell/toast";
import { MadeByLabel } from "@/components/tasks/made-by";
import { Button } from "@/components/ui/button";
import type { Document } from "@/core/documents";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";

/**
 * A document: its name and details above a printable page (US Letter, 1 inch
 * margins) on a grey desk, like Google Docs. The page is edited in place and
 * saves a moment after typing stops. Export PDF downloads it as a PDF.
 */
export function DocumentEditor({
  doc,
  projects,
  autoFocus,
}: {
  doc: Document;
  projects: { id: string; name: string }[];
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const { state, queue, flush } = useAutosave(doc.id, "update_document");
  const [title, setTitle] = useState(doc.title);
  const [projectId, setProjectId] = useState(doc.project?.id ?? null);
  const [uploading, setUploading] = useState(0);
  const [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

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

  // A document left completely empty (New document, then straight back out)
  // is deleted for good when Luke leaves it, so Trash doesn't fill up.
  const hasText = useRef({ title: !!doc.title.trim(), content: !!doc.content.trim() });
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const text = hasText.current;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current && !text.title && !text.content)
          op("delete_document", { id: doc.id })
            .then(() => op("delete_forever", { type: "document", id: doc.id }))
            .catch(() => {});
      }, 0);
    };
  }, [doc.id]);

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
      Image,
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      Markdown,
    ],
    content: doc.content,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "doc-body", "aria-label": "Document text" },
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
    onUpdate: ({ editor }) => {
      hasText.current.content = !editor.isEmpty;
      queue({ content: editor.getMarkdown() });
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (autoFocus) titleRef.current?.focus();
  }, [autoFocus]);

  async function remove() {
    await flush();
    try {
      await op("delete_document", { id: doc.id });
      showTrashedToast("document", doc.id, () => router.push(`/documents/${doc.id}`));
      router.push(projectId ? `/projects/${projectId}?view=notes` : "/documents");
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  /** Saves, then fetches the PDF. Phones get the share sheet (Save to Files, Print...); computers download it. */
  async function exportPdf() {
    setExporting(true);
    try {
      await flush();
      const res = await fetch(`/api/documents/${doc.id}/pdf`);
      if (!res.ok) throw new Error("Couldn't make the PDF. Try again.");
      const blob = await res.blob();
      const name = `${(title.trim() || "Untitled").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 120)}.pdf`;
      const file = new File([blob], name, { type: "application/pdf" });
      const touch = window.matchMedia("(pointer: coarse)").matches;
      if (touch && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
        } catch (err) {
          if ((err as Error).name !== "AbortError") throw err;
        }
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 pb-3">
        <textarea
          ref={titleRef}
          value={title}
          rows={1}
          onChange={(e) => {
            const next = e.target.value.replace(/\n/g, " ");
            setTitle(next);
            hasText.current.title = !!next.trim();
            queue({ title: next });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              editor?.commands.focus("start");
            }
          }}
          placeholder="Untitled document"
          aria-label="Document name"
          enterKeyHint="next"
          className="field-sizing-content resize-none bg-transparent text-section leading-tight font-semibold outline-none placeholder:text-muted-foreground md:text-section"
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-meta text-muted-foreground">
          <select
            value={projectId ?? ""}
            onChange={(e) => {
              const next = e.target.value || null;
              setProjectId(next);
              queue({ projectId: next }, 0);
            }}
            aria-label="Project"
            className="h-8 max-w-56 rounded-lg border bg-card px-2 text-body text-foreground border-stroke-strong md:text-meta"
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span>
            <MadeByLabel madeBy={doc.madeBy} createdAt={doc.createdAt} />
          </span>
          <span aria-live="polite" className={cn(state === "error" && "text-danger")}>
            {uploading > 0 ? "Adding photo..." : state === "saving" ? "Saving..." : state === "error" ? "Not saved yet, retrying" : "Saved"}
          </span>
          <span className="grow" />
          <Button variant="outline" size="sm" onClick={exportPdf} disabled={exporting}>
            {exporting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
            Export PDF
          </Button>
          <Button variant="danger" size="sm" onClick={remove} className="-mr-2">
            <Trash2 className="size-4" aria-hidden />
            Delete
          </Button>
        </div>
      </div>

      <DocToolbar editor={editor} onPhoto={() => fileInput.current?.click()} uploading={uploading > 0} />
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

      {/* The desk, with the page on it. */}
      <div className="doc-desk -mx-5 px-3 py-4 md:mx-0 md:rounded-b-xl md:px-6 md:py-8">
        <div
          className="doc-page cursor-text"
          onClick={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

function DocToolbar({ editor, onPhoto, uploading }: { editor: Editor | null; onPhoto: () => void; uploading: boolean }) {
  const active = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            h1: editor.isActive("heading", { level: 1 }),
            h2: editor.isActive("heading", { level: 2 }),
            h3: editor.isActive("heading", { level: 3 }),
            bold: editor.isActive("bold"),
            italic: editor.isActive("italic"),
            strike: editor.isActive("strike"),
            bullets: editor.isActive("bulletList"),
            numbers: editor.isActive("orderedList"),
            checklist: editor.isActive("taskList"),
            quote: editor.isActive("blockquote"),
            link: editor.isActive("link"),
            table: editor.isActive("table"),
          }
        : null,
  });
  if (!editor) return <div className="h-12 border-y md:rounded-t-xl md:border-x" />;
  const run = () => editor.chain().focus();

  function link() {
    if (editor!.isActive("link")) return run().unsetLink().run();
    const url = prompt("Link address", "https://");
    if (!url || url === "https://") return;
    const { empty } = editor!.state.selection;
    if (empty) run().insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }).run();
    else run().extendMarkRange("link").setLink({ href: url }).run();
  }

  const groups = [
    [
      { label: "Title", icon: Heading1, on: active?.h1, act: () => run().toggleHeading({ level: 1 }).run() },
      { label: "Heading", icon: Heading2, on: active?.h2, act: () => run().toggleHeading({ level: 2 }).run() },
      { label: "Subheading", icon: Heading3, on: active?.h3, act: () => run().toggleHeading({ level: 3 }).run() },
    ],
    [
      { label: "Bold", icon: Bold, on: active?.bold, act: () => run().toggleBold().run() },
      { label: "Italic", icon: Italic, on: active?.italic, act: () => run().toggleItalic().run() },
      { label: "Strikethrough", icon: Strikethrough, on: active?.strike, act: () => run().toggleStrike().run() },
      { label: active?.link ? "Remove link" : "Link", icon: Link2, on: active?.link, act: link },
    ],
    [
      { label: "Bulleted list", icon: List, on: active?.bullets, act: () => run().toggleBulletList().run() },
      { label: "Numbered list", icon: ListOrdered, on: active?.numbers, act: () => run().toggleOrderedList().run() },
      { label: "Checklist", icon: ListChecks, on: active?.checklist, act: () => run().toggleTaskList().run() },
      { label: "Quote", icon: Quote, on: active?.quote, act: () => run().toggleBlockquote().run() },
    ],
    [
      {
        label: active?.table ? "Remove table" : "Table",
        icon: Table,
        on: active?.table,
        act: () => (active?.table ? run().deleteTable().run() : run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
      },
      { label: "Divider", icon: Minus, on: false, act: () => run().setHorizontalRule().run() },
      { label: "Add a photo", icon: uploading ? Loader2 : ImagePlus, on: false, act: onPhoto, spin: uploading },
    ],
  ];

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="sticky top-0 z-[5] -mx-5 flex gap-0.5 overflow-x-auto border-y bg-background/95 px-3 py-1.5 backdrop-blur md:mx-0 md:rounded-t-xl md:border-x md:px-2"
    >
      {groups.map((tools, i) => (
        <span key={i} className="flex shrink-0 gap-0.5">
          {i > 0 && <span className="mx-1 my-2 w-px shrink-0 bg-border" aria-hidden />}
          {tools.map(({ label, icon: Icon, on, act, ...rest }) => (
            <button
              key={label}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={!!on}
              onMouseDown={(e) => e.preventDefault()}
              onClick={act}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-subtle-foreground hover:bg-muted aria-pressed:bg-muted aria-pressed:text-foreground md:size-8"
            >
              <Icon className={cn("size-[18px] md:size-4", "spin" in rest && rest.spin && "animate-spin")} aria-hidden />
            </button>
          ))}
        </span>
      ))}
    </div>
  );
}
