import Link from "next/link";
import { cn } from "@/lib/utils";

/** Looks like <Segmented>, for switching between views that each have their own address. */
export function SegmentedLinks({
  options,
  label,
  className,
}: {
  options: { href: string; label: string; icon?: React.ComponentType<{ className?: string }>; active: boolean }[];
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("seg-track inline-flex gap-0.5 rounded-lg p-[3px]", className)}>
      {options.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={href}
          href={href}
          replace
          scroll={false}
          aria-current={active ? "page" : undefined}
          className={cn(
            "press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] px-3 text-preview font-medium whitespace-nowrap text-muted-foreground",
            active && "seg-on text-foreground",
          )}
        >
          {Icon && <Icon className="size-4" aria-hidden />}
          {label}
        </Link>
      ))}
    </nav>
  );
}
