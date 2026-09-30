import Link from "next/link";

/**
 * The frame every screen sits in: a slim top bar on computers, and a large
 * title with the settings button on phones.
 */
export function Page({
  title,
  eyebrow,
  heading,
  children,
}: {
  title: string;
  eyebrow?: React.ReactNode;
  heading?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 grow flex-col">
      <header className="hidden h-14 shrink-0 items-center border-b px-6 md:flex">
        <span className="font-medium">{title}</span>
      </header>
      <div className="flex flex-col gap-6 px-5 pt-[max(env(safe-area-inset-top),1rem)] pb-28 md:px-10 md:pt-8 md:pb-10">
        <div className="flex items-end justify-between gap-4 pt-8 md:pt-0">
          <div>
            {eyebrow && <p className="text-[13px] text-muted-foreground">{eyebrow}</p>}
            <h1 className="mt-0.5 text-[30px] font-semibold tracking-tight md:mt-1 md:text-[28px]">{heading ?? title}</h1>
          </div>
          <Link
            href="/settings"
            aria-label="Settings"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground md:hidden"
          >
            L
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">{children}</p>;
}
