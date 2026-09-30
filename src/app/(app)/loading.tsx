/**
 * Shown the moment Luke taps to another screen, while its data loads, so a
 * tap always answers straight away. Shaped like a typical screen.
 */
export default function Loading() {
  return (
    <div className="flex min-w-0 grow flex-col" aria-busy="true" aria-label="Loading">
      <div className="hidden h-14 shrink-0 border-b md:block" />
      <div className="flex animate-pulse flex-col gap-6 px-5 pt-[max(env(safe-area-inset-top),1rem)] pb-28 md:px-10 md:pt-8 md:pb-10">
        <div className="pt-8 md:pt-0">
          <div className="h-3.5 w-28 rounded bg-muted" />
          <div className="mt-2.5 h-8 w-52 rounded-lg bg-muted" />
        </div>
        <div className="flex max-w-3xl flex-col overflow-hidden rounded-xl border bg-card">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 border-b px-4 py-3.5 last:border-b-0">
              <div className="size-[18px] shrink-0 rounded-full bg-muted" />
              <div className="h-3.5 rounded bg-muted" style={{ width: `${[55, 40, 65, 35][i]}%` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
