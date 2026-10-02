import { cn } from "@/lib/utils";

export function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${Number((bytes / 1024 / 1024 / 1024).toFixed(2))} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

/** How full storage is, as a bar: "312 MB of 1 GB". */
export function StorageMeter({ used, limit }: { used: number; limit: number }) {
  const share = Math.min(1, used / limit);
  return (
    <div className="flex flex-col gap-2">
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", share >= 0.8 ? "bg-danger" : "bg-primary")}
          style={{ width: `${Math.max(share * 100, used > 0 ? 1 : 0)}%` }}
        />
      </div>
      <span className="text-[13px] text-muted-foreground">
        {formatBytes(used)} of {formatBytes(limit)}
      </span>
    </div>
  );
}

/** Shown at the top of Inspiration once storage is getting full. */
export function StorageNotice({ used, limit, full }: { used: number; limit: number; full: boolean }) {
  return (
    <div className="flex max-w-3xl flex-col gap-2 rounded-xl border border-danger/40 bg-card px-4 py-3 shadow-xs">
      <span className="text-sm font-medium">{full ? "Storage is full" : "Storage is nearly full"}</span>
      <StorageMeter used={used} limit={limit} />
    </div>
  );
}
