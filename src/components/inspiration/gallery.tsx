"use client";

import { FileText, Globe, Play, Quote } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { InspirationItem } from "@/core/inspiration";
import { fileDetail } from "@/lib/inspiration";
import { cn } from "@/lib/utils";
import { ItemDialog } from "./item-dialog";

type Project = { id: string; name: string; color: string };

/** Smallest column width before the gallery drops a column. Phones get two. */
const MIN_COLUMN = 230;

/** Roughly how tall a tile is for its width, to share tiles out evenly between columns. */
function heightFor(item: InspirationItem) {
  const picture = item.width && item.height ? item.height / item.width : item.image ? 0.56 : 0;
  switch (item.kind) {
    case "image":
      return picture || 1;
    case "link":
    case "video":
      return picture + 0.32;
    case "text":
      return 0.3 + Math.min(item.body.length, 600) / 260;
    case "file":
      return 0.75;
  }
}

/** Shares tiles between columns, each going into the shortest so far, so the gallery stays even. */
function intoColumns(items: InspirationItem[], count: number) {
  const columns: InspirationItem[][] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(0);
  for (const item of items) {
    const shortest = heights.indexOf(Math.min(...heights));
    columns[shortest].push(item);
    heights[shortest] += heightFor(item) + 0.06;
  }
  return columns;
}

function useColumnCount() {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(2);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setCount(Math.max(2, Math.min(6, Math.floor(el.clientWidth / MIN_COLUMN))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, count };
}

/** Uneven-height tiles, like mymind or Pinterest. Tapping one opens it. */
export function Gallery({
  items,
  projects,
  openItem,
}: {
  items: InspirationItem[];
  projects: Project[];
  /** Opened from a link (?item=), even if the filters hide it. */
  openItem?: InspirationItem | null;
}) {
  const { ref, count } = useColumnCount();
  const [open, setOpen] = useState<string | null>(openItem?.id ?? null);
  const current = items.find((i) => i.id === open) ?? (openItem?.id === open ? openItem : null);

  // The open item is in the address (?item=), so a link from Messages or search opens it.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (open) url.searchParams.set("item", open);
    else url.searchParams.delete("item");
    if (url.toString() !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [open]);

  return (
    <>
      <div ref={ref} className="flex items-start gap-3 md:gap-4">
        {intoColumns(items, count).map((column, i) => (
          <div key={i} className="flex min-w-0 flex-1 flex-col gap-3 md:gap-4">
            {column.map((item) => (
              <Tile key={item.id} item={item} onOpen={() => setOpen(item.id)} />
            ))}
          </div>
        ))}
      </div>
      {current && <ItemDialog key={current.id} item={current} projects={projects} onClose={() => setOpen(null)} />}
    </>
  );
}

function Picture({ item, className }: { item: InspirationItem; className?: string }) {
  if (!item.thumb) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={item.thumb}
      alt={item.title}
      loading="lazy"
      decoding="async"
      width={item.width ?? undefined}
      height={item.height ?? undefined}
      style={item.width && item.height ? { aspectRatio: `${item.width} / ${item.height}` } : undefined}
      className={cn("block h-auto w-full bg-muted object-cover", className)}
    />
  );
}

function Tile({ item, onOpen }: { item: InspirationItem; onOpen: () => void }) {
  const label = item.title || item.site || { image: "Picture", link: "Link", video: "Video", text: "Quote", file: "File" }[item.kind];
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className="pressable group block w-full overflow-hidden rounded-xl border bg-card text-left shadow-xs hover:border-foreground/20"
    >
      {item.kind === "image" && <Picture item={item} className="transition-transform group-hover:scale-[1.015]" />}

      {(item.kind === "link" || item.kind === "video") && (
        <>
          {item.thumb && (
            <span className="relative block overflow-hidden">
              <Picture item={item} />
              {item.kind === "video" && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                    <Play className="ml-0.5 size-5 fill-current" aria-hidden />
                  </span>
                </span>
              )}
            </span>
          )}
          <span className="flex flex-col gap-1 px-3 py-2.5">
            {item.title && <span className="line-clamp-3 text-[14px] leading-snug font-medium md:text-[13px]">{item.title}</span>}
            <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              {item.kind === "video" && !item.thumb ? <Play className="size-3 shrink-0" aria-hidden /> : <Globe className="size-3 shrink-0" aria-hidden />}
              {item.site}
            </span>
          </span>
        </>
      )}

      {item.kind === "text" && (
        <span className="flex flex-col gap-2 px-4 py-4">
          <Quote className="size-4 text-muted-foreground" aria-hidden />
          <span className="line-clamp-[12] font-serif text-[16px] leading-relaxed whitespace-pre-line md:text-[15px]">{item.body}</span>
          {(item.title || item.site) && <span className="truncate text-xs text-muted-foreground">{item.title || item.site}</span>}
        </span>
      )}

      {item.kind === "file" && (
        <span className="flex flex-col items-start gap-3 px-4 py-4">
          <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FileText className="size-5" aria-hidden />
          </span>
          <span className="line-clamp-2 text-[14px] leading-snug font-medium md:text-[13px]">{item.title || item.file?.name}</span>
          {item.file && <span className="text-xs text-muted-foreground">{fileDetail(item.file)}</span>}
        </span>
      )}
    </button>
  );
}
