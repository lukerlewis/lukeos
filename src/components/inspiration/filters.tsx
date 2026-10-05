"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** This page's address with one filter changed (and no open item). */
function useHref() {
  const pathname = usePathname();
  const params = useSearchParams();
  return (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    next.delete("item");
    if (value) next.set(key, value);
    else next.delete(key);
    const s = next.toString();
    return s ? `${pathname}?${s}` : pathname;
  };
}

/** Searches as you type (titles, text, notes, Claude's descriptions and tags). */
export function SearchBox({ query }: { query: string }) {
  const router = useRouter();
  const href = useHref();
  const [value, setValue] = useState(query);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function change(next: string) {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => router.replace(href("q", next.trim() || null), { scroll: false }), 300);
  }

  return (
    <label className="flex h-10 w-full items-center gap-2 rounded-lg border border-stroke-strong bg-card px-3 focus-within:border-ring md:max-w-sm">
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => change(e.target.value)}
        placeholder="Search"
        aria-label="Search Inspiration"
        className="min-w-0 grow bg-transparent text-body outline-none placeholder:text-muted-foreground md:text-meta [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" onClick={() => change("")} aria-label="Clear" className="text-muted-foreground hover:text-foreground">
          <X className="size-4" aria-hidden />
        </button>
      )}
    </label>
  );
}

/** The most used tags, to narrow the gallery to one. */
export function TagChips({ tags, active }: { tags: { tag: string; count: number }[]; active: string | null }) {
  const href = useHref();
  if (!tags.length && !active) return null;
  const shown = active && !tags.some((t) => t.tag === active) ? [{ tag: active, count: 0 }, ...tags] : tags;
  return (
    <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-0.5 md:mx-0 md:flex-wrap md:px-0">
      {shown.map(({ tag }) => {
        const on = tag === active;
        return (
          <Link
            key={tag}
            href={href("tag", on ? null : tag)}
            replace
            scroll={false}
            className={cn(
              "press inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-stroke px-3 text-preview whitespace-nowrap",
              on ? "border-transparent bg-selected font-medium text-ink" : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {tag}
            {on && <X className="size-3" aria-hidden />}
          </Link>
        );
      })}
    </div>
  );
}
