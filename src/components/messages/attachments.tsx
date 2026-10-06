"use client";

import { Download, FileText, Loader2, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import { shrinkForUpload } from "@/components/inspiration/saving";
import { fileSize } from "@/lib/archive";
import { attachmentKind, DIRECT_UPLOAD_BYTES, MAX_MESSAGE_FILE_BYTES } from "@/lib/message-files";
import { cn } from "@/lib/utils";

/** A photo, video or file sent with a message, as the chain shows it. */
export type ThreadAttachment = {
  id: string;
  kind: "image" | "video" | "file";
  name: string;
  mimeType: string;
  bytes: number;
  url: string;
  thumb: string | null;
  width: number | null;
  height: number | null;
};

/** What the server keeps for a picked file, passed to send_message once it's sent. */
export type Uploaded = {
  fileId: string;
  thumbId?: string | null;
  kind: ThreadAttachment["kind"];
  name: string;
  mimeType: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
};

export function asThreadAttachment(u: Uploaded): ThreadAttachment {
  return {
    id: u.fileId,
    kind: u.kind,
    name: u.name,
    mimeType: u.mimeType,
    bytes: u.bytes,
    url: `/api/stored/${u.fileId}`,
    thumb: u.thumbId ? `/api/stored/${u.thumbId}` : null,
    width: u.width ?? null,
    height: u.height ?? null,
  };
}

const extension = (name: string) => name.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() ?? "bin";

/** A video's width and height, read in the browser. */
function videoSize(file: File) {
  return new Promise<{ width: number | null; height: number | null }>((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (size: { width: number | null; height: number | null }) => {
      URL.revokeObjectURL(url);
      resolve(size);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => done({ width: video.videoWidth || null, height: video.videoHeight || null });
    video.onerror = () => done({ width: null, height: null });
    setTimeout(() => done({ width: null, height: null }), 4000);
    video.src = url;
  });
}

/**
 * Sends one picked file to LukeOS. Photos are shrunk first; small files go
 * through the app, and big ones (videos) straight to Blob storage.
 */
export async function uploadAttachment(file: File, onProgress: (share: number) => void): Promise<Uploaded> {
  const label = file.name || "That file";
  if (file.size > MAX_MESSAGE_FILE_BYTES) throw new Error(`${label} is over 100 MB.`);
  const picture = attachmentKind(file.type) === "image";
  const body = picture ? await shrinkForUpload(file) : file;
  // A video's shape, so the chain can leave the right space for it.
  const size = attachmentKind(file.type) === "video" ? await videoSize(file) : { width: null, height: null };

  if (body.size <= DIRECT_UPLOAD_BYTES) {
    const res = await fetch("/api/messages/upload", {
      method: "POST",
      headers: {
        "content-type": body.type || file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name || (picture ? "Photo" : "File")),
      },
      body,
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error ?? `Couldn't add ${label}.`);
    onProgress(1);
    return { ...size, ...(out as Uploaded) };
  }

  const { mode } = await fetch("/api/messages/upload/blob").then((r) => r.json()).catch(() => ({ mode: "none" }));
  if (mode !== "token" && mode !== "presigned") throw new Error(`${label} is over 4 MB.`);
  const { upload, uploadPresigned } = await import("@vercel/blob/client");
  const send = mode === "token" ? upload : uploadPresigned;
  const pathname = `messages/${crypto.randomUUID()}.${extension(file.name)}`;
  let lastError: unknown;
  // The store is private or public, and only accepts its own kind.
  for (const access of ["private", "public"] as const) {
    try {
      const blob = await send(pathname, file, {
        access,
        handleUploadUrl: "/api/messages/upload/blob",
        contentType: file.type || "application/octet-stream",
        multipart: file.size > 20 * 1024 * 1024,
        onUploadProgress: (p) => onProgress(p.percentage / 100),
      });
      const res = await fetch("/api/messages/upload", {
        method: "POST",
        headers: { "content-type": "application/json", "x-blob": "1" },
        body: JSON.stringify({ url: blob.url, access, name: file.name || "File", mimeType: file.type || "application/octet-stream", ...size }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? `Couldn't add ${label}.`);
      return out as Uploaded;
    } catch (err) {
      lastError = err;
    }
  }
  console.error("[messages] upload failed", lastError);
  throw new Error(`Couldn't add ${label}. Try again.`);
}

/** A file picked in the box, while it uploads and before it's sent. */
export type Pending = {
  key: string;
  file: File;
  /** A local preview for photos and videos. */
  preview: string | null;
  progress: number;
  uploaded: Uploaded | null;
  error: string | null;
};

/** The row of picked files above the message box, each with a way to take it off. */
export function PendingTray({ items, onRemove }: { items: Pending[]; onRemove: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="mx-auto flex max-w-2xl gap-2 overflow-x-auto px-1 pt-1 pb-2" aria-label="Attachments" data-no-pull>
      {items.map((p) => {
        const kind = attachmentKind(p.file.type);
        const busy = !p.uploaded && !p.error;
        return (
          <li key={p.key} className="relative shrink-0">
            <div
              className={cn(
                "relative flex size-16 items-center justify-center overflow-hidden rounded-xl border bg-muted",
                p.error && "border-danger",
              )}
              title={p.error ?? p.file.name}
            >
              {p.preview && kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.preview} alt="" className="size-full object-cover" />
              ) : p.preview && kind === "video" ? (
                <>
                  <video src={`${p.preview}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />
                  <Play className="absolute size-5 fill-white text-white drop-shadow" aria-hidden />
                </>
              ) : (
                <span className="flex flex-col items-center gap-0.5 px-1 text-center">
                  <FileText className="size-5 text-muted-foreground" aria-hidden />
                  <span className="w-14 truncate text-xs leading-tight">{p.file.name}</span>
                </span>
              )}
              {busy && (
                <span className="absolute inset-0 flex items-center justify-center bg-background/50">
                  {p.progress > 0 && p.progress < 1 ? (
                    <span className="text-xs font-medium tabular-nums">{Math.round(p.progress * 100)}%</span>
                  ) : (
                    <Loader2 className="size-4 animate-spin" aria-label="Adding" />
                  )}
                </span>
              )}
              {p.error && (
                <span className="absolute inset-x-0 bottom-0 bg-danger px-1 text-center text-xs text-white">Failed</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => onRemove(p.key)}
              aria-label={`Remove ${p.file.name || "attachment"}`}
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background"
            >
              <X className="size-3" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Photos, videos and files under one message, on Luke's side or Claude's. */
export function MessageAttachments({
  attachments,
  mine,
  pending,
  onOpen,
}: {
  attachments: ThreadAttachment[];
  mine: boolean;
  pending: boolean;
  onOpen: (a: ThreadAttachment) => void;
}) {
  const pictures = attachments.filter((a) => a.kind === "image");
  const videos = attachments.filter((a) => a.kind === "video");
  const files = attachments.filter((a) => a.kind === "file");
  const side = mine ? "self-end" : "self-start";
  return (
    <>
      {pictures.length === 1 && (
        <button
          type="button"
          onClick={() => onOpen(pictures[0])}
          className={cn("press-tint mb-1 max-w-[70%] overflow-hidden rounded-[18px] bg-muted md:max-w-[50%]", side, pending && "opacity-60")}
          aria-label={`Photo: ${pictures[0].name}`}
        >
          <Picture a={pictures[0]} className="max-h-[360px] w-auto" />
        </button>
      )}
      {pictures.length > 1 && (
        <div className={cn("mb-1 grid w-[75%] grid-cols-2 gap-1 md:w-[50%]", side, pending && "opacity-60")}>
          {pictures.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onOpen(a)}
              className="press-tint aspect-square overflow-hidden rounded-[14px] bg-muted"
              aria-label={`Photo: ${a.name}`}
            >
              <Picture a={a} className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {videos.map((a) => (
        <video
          key={a.id}
          src={`${a.url}#t=0.1`}
          controls
          playsInline
          preload="metadata"
          width={a.width ?? undefined}
          height={a.height ?? undefined}
          className={cn("mb-1 h-auto max-h-[420px] max-w-[70%] rounded-[18px] bg-black md:max-w-[50%]", side, pending && "opacity-60")}
          aria-label={`Video: ${a.name}`}
        />
      ))}
      {files.map((a) => (
        <a
          key={a.id}
          href={`${a.url}?name=${encodeURIComponent(a.name)}`}
          target="_blank"
          rel="noreferrer"
          className={cn("press-tint mb-1 flex max-w-[80%] items-center gap-2.5 rounded-2xl border bg-card px-3 py-2 md:max-w-[70%]", side, pending && "opacity-60")}
        >
          <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex min-w-0 flex-col text-left">
            <span className="truncate text-preview font-medium">{a.name}</span>
            <span className="text-meta text-muted-foreground">
              {fileKind(a)} · {fileSize(a.bytes)}
            </span>
          </span>
        </a>
      ))}
    </>
  );
}

/** "PDF", "DOCX", "File". */
function fileKind(a: ThreadAttachment) {
  if (a.mimeType === "application/pdf") return "PDF";
  const ext = a.name.match(/\.([a-z0-9]{1,6})$/i)?.[1];
  return ext ? ext.toUpperCase() : "File";
}

function Picture({ a, className }: { a: ThreadAttachment; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={a.thumb ?? a.url}
      srcSet={a.thumb && a.width ? `${a.thumb} 640w, ${a.url} ${a.width}w` : undefined}
      sizes="(max-width: 768px) 70vw, 360px"
      width={a.width ?? undefined}
      height={a.height ?? undefined}
      alt={a.name}
      loading="lazy"
      className={cn("block h-auto", className)}
    />
  );
}

/** A photo filling the screen, with a way to save it. Tap anywhere or press Escape to close. */
export function PhotoViewer({ photo, onClose }: { photo: ThreadAttachment | null; onClose: () => void }) {
  useEffect(() => {
    if (!photo) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photo, onClose]);
  const [loaded, setLoaded] = useState<string | null>(null);
  if (!photo) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={photo.name}
      onClick={onClose}
      data-no-pull
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-2 pt-[calc(env(safe-area-inset-top)+3rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]"
    >
      <div className="absolute top-[calc(env(safe-area-inset-top)+0.5rem)] right-2 left-2 flex justify-between">
        <a
          href={`${photo.url}?name=${encodeURIComponent(photo.name)}`}
          download={photo.name}
          onClick={(e) => e.stopPropagation()}
          aria-label="Save photo"
          className="flex size-10 items-center justify-center rounded-full text-white/90"
        >
          <Download className="size-5" aria-hidden />
        </a>
        <button type="button" aria-label="Close" className="flex size-10 items-center justify-center rounded-full text-white/90">
          <X className="size-6" aria-hidden />
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={loaded === photo.url ? photo.url : (photo.thumb ?? photo.url)}
        alt={photo.name}
        className="max-h-full max-w-full object-contain"
      />
      {/* The full-size copy loads behind the small one, then swaps in. */}
      {photo.thumb && loaded !== photo.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.url} alt="" className="hidden" onLoad={() => setLoaded(photo.url)} />
      )}
    </div>
  );
}
