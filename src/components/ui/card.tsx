import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("overflow-hidden rounded-xl border border-stroke bg-card", className)} {...props} />;
}

export function CardHeader({ title, aside }: { title: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b px-4 py-3.5">
      <h2 className="text-heading font-medium">{title}</h2>
      {aside && <span className="text-meta text-muted-foreground">{aside}</span>}
    </div>
  );
}
