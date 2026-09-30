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
    <nav aria-label={label} className={cn("inline-flex gap-0.5 rounded-[10px] bg-muted p-[3px]", className)}>
      {options.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={href}
          href={href}
          replace
          scroll={false}
          aria-current={active ? "page" : undefined}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground",
            active && "bg-card text-foreground shadow-xs dark:bg-background",
          )}
        >
          {Icon && <Icon className="size-3.5" aria-hidden />}
          {label}
        </Link>
      ))}
    </nav>
  );
}
