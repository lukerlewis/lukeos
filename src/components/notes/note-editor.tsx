"use client";

import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Image } from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  Bold,
  Heading1,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MadeByLabel } from "@/components/tasks/made-by";
import { Button } from "@/components/ui/button";
import type { Note } from "@/core/notes";
import { showTrashedToast } from "@/components/shell/toast";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import { ClaudeTag } from "./claude-tag";
import { PinButton } from "./pin-button";
import { shrinkPhoto } from "./photos";

type SaveState = "saved" | "saving" | "error";
type Change = {
  title?: string;
  content?: string;
  projectId?: string | null;
  folderId?: string | null;
  description?: string;
  body?: string;
  instructions?: string;
  frequency?: "daily" | "weekly" | "monthly";
  time?: string;
  days?: number[];
  dayOfMonth?: number;
  sopId?: string | null;
  enabled?: boolean;
  pinned?: boolean;
  story?: string;
  size?: "win" | "story" | "project";
  stage?: "raw" | "drafted" | "published";
  company?: string | null;
  role?: string | null;
  period?: string | null;
  outcome?: string | null;
  confidential?: boolean;
};

/**
 * Saves changes a moment after typing stops, one save at a time, and makes
 * sure nothing is lost when Luke leaves the page or switches apps.
 */
export function useAutosave(noteId: string, save: "update_note" | "update_sop" | "update_routine" | "update_archive_entry" = "update_note") {
  const [state, setState] = useState<SaveState>("saved");
  const pending = useRef<Change>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const running = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback(() => {
    const run = (): Promise<void> => {
      clearTimeout(timer.current);
      running.current = running.current.then(async () => {
        const change = pending.current;
        if (Object.keys(change).length === 0) return;
        pending.current = {};
        try {
          await op(save, { id: noteId, ...change });
          setState(Object.keys(pending.current).length ? "saving" : "saved");
        } catch {
          // Keep the unsaved change (newer edits win) and try again shortly.
          pending.current = { ...change, ...pending.current };
          setState("error");
          timer.current = setTimeout(run, 5000);
        }
      });
      return running.current;
    };
    return run();
  }, [noteId, save]);

  const queue = useCallback(
    (change: Change, delay = 800) => {
      Object.assign(pending.current, change);
      setState("saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && flush();
    const onUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) {
        flush();
        e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
      flush();
    };
  }, [flush]);

  return { state, queue, flush };
}

export function NoteEditor({
  note,
  projects,
  folders,
  autoFocus,
}: {
  note: Note;
  projects: { id: string; name: string }[];
  folders: { id: string; name: string }[];
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const { state, queue, flush } = useAutosave(note.id);
  const [title, setTitle] = useState(note.title);
  const [projectId, setProjectId] = useState(note.project?.id ?? null);
  const [folderId, setFolderId] = useState(note.folder?.id ?? null);
  const [pinned, setPinned] = useState(note.pinned);
  const [uploading, setUploading] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // Photos pasted, dropped or picked are shrunk, saved, then placed in the note.
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

  // A note left completely empty (New note, then straight back out) isn't
  // worth keeping, so it's deleted when Luke leaves it (for good, so Trash
  // doesn't fill up with empty notes). The short wait
  // skips React's practice unmount in development.
  const hasText = useRef({ title: !!note.title.trim(), content: !!note.content.trim() });
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const text = hasText.current;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current && !text.title && !text.content)
          op("delete_note", { id: note.id })
            .then(() => op("delete_forever", { type: "note", id: note.id }))
            .catch(() => {});
      }, 0);
    };
  }, [note.id]);

  // The paste and drop handlers are set once, so they reach the editor through a ref.
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
      Placeholder.configure({ placeholder: "Start writing…" }),
      Markdown,
      ClaudeTag,
    ],
    content: note.content,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "note-body", "aria-label": "Note text" },
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
      await op("delete_note", { id: note.id });
      showTrashedToast("note", note.id, () => router.push(`/notes/${note.id}`));
      router.push(folderId ? `/notes?folder=${folderId}` : projectId ? `/projects/${projectId}?view=notes` : "/notes");
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
        placeholder="Untitled"
        aria-label="Title"
        enterKeyHint="next"
        className="field-sizing-content resize-none bg-transparent text-[30px] leading-tight font-semibold tracking-tight outline-none placeholder:text-muted-foreground md:text-[28px]"
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <select
          value={projectId ?? ""}
          onChange={(e) => {
            const next = e.target.value || null;
            setProjectId(next);
            queue({ projectId: next }, 0);
          }}
          aria-label="Project"
          className="h-8 max-w-56 rounded-lg border bg-card px-2 text-[16px] text-foreground md:text-[13px] shadow-xs"
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={folderId ?? ""}
          onChange={(e) => {
            const next = e.target.value || null;
            setFolderId(next);
            queue({ folderId: next }, 0);
          }}
          aria-label="Folder"
          className="h-8 max-w-56 rounded-lg border bg-card px-2 text-[16px] text-foreground md:text-[13px] shadow-xs"
        >
          <option value="">No folder</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <span>
          <MadeByLabel madeBy={note.madeBy} createdAt={note.createdAt} />
        </span>
        <span aria-live="polite" className={cn(state === "error" && "text-danger")}>
          {uploading > 0 ? "Adding photo..." : state === "saving" ? "Saving..." : state === "error" ? "Not saved yet, retrying" : "Saved"}
        </span>
        <span className="grow" />
        <PinButton
          pinned={pinned}
          onChange={(next) => {
            setPinned(next);
            queue({ pinned: next }, 0);
          }}
        />
        <Button variant="danger" size="sm" onClick={remove} className="-mr-2">
          <Trash2 className="size-4" aria-hidden />
          Delete
        </Button>
      </div>

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

      <div className="min-h-[50dvh] cursor-text pb-10" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export function imageFiles(list: FileList | null | undefined) {
  return Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
}

export function Toolbar({ editor, onPhoto, uploading }: { editor: Editor | null; onPhoto?: () => void; uploading?: boolean }) {
  const active = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            h1: editor.isActive("heading", { level: 1 }),
            h2: editor.isActive("heading", { level: 2 }),
            bold: editor.isActive("bold"),
            italic: editor.isActive("italic"),
            bullets: editor.isActive("bulletList"),
            numbers: editor.isActive("orderedList"),
            checklist: editor.isActive("taskList"),
            link: editor.isActive("link"),
          }
        : null,
  });
  if (!editor) return <div className="h-10" />;
  const run = () => editor.chain().focus();

  function link() {
    if (editor!.isActive("link")) return run().unsetLink().run();
    const url = prompt("Link address", "https://");
    if (!url || url === "https://") return;
    const { empty } = editor!.state.selection;
    if (empty) run().insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }).run();
    else run().extendMarkRange("link").setLink({ href: url }).run();
  }

  const tools = [
    { label: "Heading", icon: Heading1, on: active?.h1, act: () => run().toggleHeading({ level: 1 }).run() },
    { label: "Subheading", icon: Heading2, on: active?.h2, act: () => run().toggleHeading({ level: 2 }).run() },
    { label: "Bold", icon: Bold, on: active?.bold, act: () => run().toggleBold().run() },
    { label: "Italic", icon: Italic, on: active?.italic, act: () => run().toggleItalic().run() },
    { label: "Bulleted list", icon: List, on: active?.bullets, act: () => run().toggleBulletList().run() },
    { label: "Numbered list", icon: ListOrdered, on: active?.numbers, act: () => run().toggleOrderedList().run() },
    { label: "Checklist", icon: ListChecks, on: active?.checklist, act: () => run().toggleTaskList().run() },
    { label: active?.link ? "Remove link" : "Link", icon: Link2, on: active?.link, act: link },
  ];

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="sticky top-0 z-[5] -mx-2 flex gap-0.5 overflow-x-auto border-b bg-background/95 px-2 py-1.5 backdrop-blur md:top-0"
    >
      {tools.map(({ label, icon: Icon, on, act }) => (
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
          <Icon className="size-[18px] md:size-4" aria-hidden />
        </button>
      ))}
      {onPhoto && <span className="mx-0.5 my-2 w-px shrink-0 bg-border" aria-hidden />}
      {onPhoto && <button
        type="button"
        title="Add a photo"
        aria-label="Add a photo"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onPhoto}
        disabled={uploading}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-subtle-foreground hover:bg-muted md:size-8"
      >
        {uploading ? <Loader2 className="size-[18px] animate-spin md:size-4" aria-hidden /> : <ImagePlus className="size-[18px] md:size-4" aria-hidden />}
      </button>}
    </div>
  );
}
