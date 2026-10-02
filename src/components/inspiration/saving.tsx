"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { showToast } from "@/components/shell/toast";
import { MAX_UPLOAD_BYTES } from "@/lib/inspiration";
import { op } from "@/lib/ops-client";

/** Longest side of a picture before it's sent. The server makes the final copies. */
const SEND_SIDE = 2000;

/** Shrinks a photo in the browser so it fits in one upload. GIFs go as they are, to keep the animation. */
async function shrinkForUpload(file: File): Promise<Blob> {
  if (file.type === "image/gif" && file.size <= MAX_UPLOAD_BYTES) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Something the browser can't draw (HEIC on some browsers): let the server try.
    return file;
  }
  const scale = Math.min(1, SEND_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= MAX_UPLOAD_BYTES && /^image\/(jpeg|png|webp)$/.test(file.type)) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.92));
  if (blob && blob.type === "image/webp") return blob;
  return (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9))) ?? file;
}

async function uploadFile(file: File, projectId?: string | null) {
  const body = file.type.startsWith("image/") && file.type !== "image/svg+xml" ? await shrinkForUpload(file) : file;
  if (body.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name || "That file"} is over 4 MB.`);
  const res = await fetch("/api/inspiration/upload", {
    method: "POST",
    headers: {
      "content-type": body.type || file.type || "application/octet-stream",
      "x-file-name": encodeURIComponent(file.name || "Picture"),
      ...(projectId && { "x-project-id": projectId }),
    },
    body,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? "Couldn't save that. Try again.");
  return out as { id: string };
}

type Saving = {
  /** Saves files (pictures, PDFs...), links or text, one at a time. */
  save: (things: { files?: File[]; text?: string }) => void;
  busy: number;
};

const SavingContext = createContext<Saving | null>(null);

export function useSaving() {
  const ctx = useContext(SavingContext);
  if (!ctx) throw new Error("useSaving outside SavingProvider");
  return ctx;
}

/**
 * Keeps track of things being saved to Inspiration, so dropping, pasting and
 * the add sheet all work the same way and the gallery refreshes as each lands.
 */
export function SavingProvider({ projectId, children }: { projectId?: string | null; children: React.ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(0);
  const queue = useRef(Promise.resolve());

  const save = useCallback(
    ({ files = [], text }: { files?: File[]; text?: string }) => {
      const jobs: (() => Promise<unknown>)[] = files.map((file) => () => uploadFile(file, projectId));
      if (text?.trim()) jobs.push(() => op("add_inspiration", { text: text.trim(), projectId: projectId ?? undefined }));
      if (!jobs.length) return;
      setBusy((n) => n + jobs.length);
      for (const job of jobs) {
        queue.current = queue.current.then(async () => {
          try {
            await job();
            router.refresh();
          } catch (err) {
            showToast((err as Error).message);
          } finally {
            setBusy((n) => n - 1);
          }
        });
      }
    },
    [projectId, router],
  );

  const value = useMemo(() => ({ save, busy }), [save, busy]);
  return <SavingContext.Provider value={value}>{children}</SavingContext.Provider>;
}

/** "Saving 2…", while things upload. */
export function SavingPill() {
  const { busy } = useSaving();
  if (!busy) return null;
  return (
    <div className="motion-toast fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background shadow-lg md:bottom-6">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Saving{busy > 1 ? ` ${busy}` : ""}…
    </div>
  );
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}

/** What was dropped or pasted: files, or else a link, or else text. */
function thingsFrom(data: DataTransfer) {
  const files = Array.from(data.files ?? []);
  if (files.length) return { files };
  const uri = data
    .getData("text/uri-list")
    .split(/\r?\n/)
    .find((l) => l.trim() && !l.startsWith("#"));
  if (uri) return { text: uri.trim() };
  const text = data.getData("text/plain");
  return text.trim() ? { text } : null;
}

/**
 * On a computer, drop anything anywhere on the page to save it, and paste
 * (Cmd+V) when you're not typing in a box.
 */
export function DropAndPaste() {
  const { save } = useSaving();
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  // Dialogs are open when they're the active element's ancestor; dropping then goes to them.
  const dialogOpen = () => !!document.querySelector("dialog[open]");

  useEffect(() => {
    const hasStuff = (e: DragEvent) => {
      const types = Array.from(e.dataTransfer?.types ?? []);
      return types.includes("Files") || types.includes("text/uri-list") || types.includes("text/plain");
    };
    const enter = (e: DragEvent) => {
      if (!hasStuff(e) || dialogOpen()) return;
      depth.current += 1;
      setOver(true);
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const overHandler = (e: DragEvent) => {
      if (!hasStuff(e) || dialogOpen()) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const drop = (e: DragEvent) => {
      depth.current = 0;
      setOver(false);
      if (!e.dataTransfer || dialogOpen()) return;
      // Dragging a card within the page isn't something to save.
      if (e.dataTransfer.types.includes("application/x-lukeos")) return;
      e.preventDefault();
      const things = thingsFrom(e.dataTransfer);
      if (things) save(things);
    };
    const paste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || dialogOpen() || !e.clipboardData) return;
      const things = thingsFrom(e.clipboardData);
      if (!things) return;
      e.preventDefault();
      save(things);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overHandler);
    window.addEventListener("drop", drop);
    document.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overHandler);
      window.removeEventListener("drop", drop);
      document.removeEventListener("paste", paste);
    };
  }, [save]);

  if (!over) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-background/70 p-6 backdrop-blur-[2px]">
      <div className="flex h-full max-h-[70dvh] w-full max-w-3xl items-center justify-center rounded-3xl border-2 border-dashed border-foreground/30 text-lg font-medium">
        Drop to save
      </div>
    </div>
  );
}
