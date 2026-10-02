"use client";

import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Image } from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Lock, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { imageFiles, Toolbar, useAutosave } from "@/components/notes/note-editor";
import { shrinkPhoto } from "@/components/notes/photos";
import { showTrashedToast } from "@/components/shell/toast";
import { MadeByLabel } from "@/components/tasks/made-by";
import { Button } from "@/components/ui/button";
import type { Entry } from "@/core/archive";
import { entrySizes, entryStages, sizeLabel, stageLabel, type EntrySize, type EntryStage } from "@/lib/archive";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import { EntryFiles } from "./entry-files";

type Detail = "company" | "role" | "period" | "outcome";
const details: { key: Detail; label: string }[] = [
  { key: "company", label: "Company" },
  { key: "role", label: "Role" },
  { key: "period", label: "When" },
  { key: "outcome", label: "Outcome" },
];

const selectClass = "h-8 rounded-lg border bg-card px-2 text-[16px] text-foreground shadow-xs md:text-[13px]";

export function EntryEditor({ entry, autoFocus }: { entry: Entry; autoFocus?: boolean }) {
  const router = useRouter();
  const { state, queue, flush } = useAutosave(entry.id, "update_archive_entry");
  const [title, setTitle] = useState(entry.title);
  const [size, setSize] = useState<EntrySize>(entry.size);
  const [stage, setStage] = useState<EntryStage>(entry.stage);
  const [confidential, setConfidential] = useState(entry.confidential);
  const [values, setValues] = useState<Record<Detail, string>>({
    company: entry.company ?? "",
    role: entry.role ?? "",
    period: entry.period ?? "",
    outcome: entry.outcome ?? "",
  });
  const [uploading, setUploading] = useState(0);
  const photoInput = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // An entry left completely empty (New entry, then straight back out) is deleted for good when Luke leaves it.
  const filled = useRef({
    title: !!entry.title.trim(),
    story: !!entry.story.trim(),
    details: Object.values(values).some((v) => v.trim()),
    files: entry.files.length > 0,
  });
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const f = filled.current;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current && !f.title && !f.story && !f.details && !f.files)
          op("delete_archive_entry", { id: entry.id })
            .then(() => op("delete_forever", { type: "entry", id: entry.id }))
            .catch(() => {});
      }, 0);
    };
  }, [entry.id]);

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
      Image,
      Placeholder.configure({ placeholder: "Tell the story…" }),
      Markdown,
    ],
    content: entry.story,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "note-body", "aria-label": "Story" },
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
      filled.current.story = !editor.isEmpty;
      queue({ story: editor.getMarkdown() });
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
      await op("delete_archive_entry", { id: entry.id });
      showTrashedToast("entry", entry.id, () => router.push(`/archive/${entry.id}`));
      router.push("/archive");
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
        maxLength={300}
        onChange={(e) => {
          const next = e.target.value.replace(/\n/g, " ");
          setTitle(next);
          filled.current.title = !!next.trim();
          queue({ title: next });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            document.getElementById("entry-company")?.focus();
          }
        }}
        placeholder="Untitled"
        aria-label="Title"
        enterKeyHint="next"
        className="field-sizing-content resize-none bg-transparent text-[30px] leading-tight font-semibold tracking-tight outline-none placeholder:text-muted-foreground md:text-[28px]"
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <select
          value={size}
          onChange={(e) => {
            const next = e.target.value as EntrySize;
            setSize(next);
            queue({ size: next }, 0);
          }}
          aria-label="Size"
          className={selectClass}
        >
          {entrySizes.map((s) => (
            <option key={s} value={s}>
              {sizeLabel[s]}
            </option>
          ))}
        </select>
        <select
          value={stage}
          onChange={(e) => {
            const next = e.target.value as EntryStage;
            setStage(next);
            queue({ stage: next }, 0);
          }}
          aria-label="Stage"
          className={selectClass}
        >
          {entryStages.map((s) => (
            <option key={s} value={s}>
              {stageLabel[s]}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={confidential}
          onClick={() => {
            setConfidential(!confidential);
            queue({ confidential: !confidential }, 0);
          }}
          className={cn(
            "press inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] shadow-xs",
            confidential ? "border-foreground/30 bg-muted text-foreground" : "bg-card text-muted-foreground",
          )}
        >
          <Lock className="size-3.5" aria-hidden />
          Confidential
        </button>
        <span>
          <MadeByLabel madeBy={entry.madeBy} createdAt={entry.createdAt} />
        </span>
        <span aria-live="polite" className={cn(state === "error" && "text-danger")}>
          {uploading > 0 ? "Adding photo..." : state === "saving" ? "Saving..." : state === "error" ? "Not saved yet, retrying" : "Saved"}
        </span>
        <span className="grow" />
        <Button variant="danger" size="sm" onClick={remove} className="-mr-2">
          <Trash2 className="size-4" aria-hidden />
          Delete
        </Button>
      </div>

      <div className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card shadow-xs">
        {details.map(({ key, label }, i) => (
          <label key={key} className={cn("flex min-w-0 flex-col gap-0.5 px-3 py-2", i % 2 === 1 && "border-l", i >= 2 && "border-t")}>
            <span className="text-xs text-muted-foreground">{label}</span>
            <input
              id={`entry-${key}`}
              value={values[key]}
              maxLength={300}
              onChange={(e) => {
                const next = { ...values, [key]: e.target.value };
                setValues(next);
                filled.current.details = Object.values(next).some((v) => v.trim());
                queue({ [key]: e.target.value.trim() || null });
              }}
              aria-label={label}
              className="min-w-0 bg-transparent text-[16px] outline-none md:text-sm"
            />
          </label>
        ))}
      </div>

      <EntryFiles entryId={entry.id} files={entry.files} onChange={(n) => (filled.current.files = n > 0)} />

      <Toolbar editor={editor} onPhoto={() => photoInput.current?.click()} uploading={uploading > 0} />
      <input
        ref={photoInput}
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
