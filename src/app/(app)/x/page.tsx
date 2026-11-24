import type { Metadata } from "next";
import Link from "next/link";
import { X } from "lucide-react";
import { PeopleButton } from "@/components/x-feed/people";
import { XFeed } from "@/components/x-feed/feed";
import { Page } from "@/components/shell/page";
import { feedViews, getFeed, type FeedView } from "@/core/x-feed";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "X feed · LukeOS" };

const chip = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-meta whitespace-nowrap";
const on = "bg-selected font-medium text-ink";
const off = "border bg-card text-muted-foreground hover:bg-muted";
const row = "-mx-5 flex gap-1.5 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:px-0";

const views: { view: FeedView | undefined; label: string }[] = [
  { view: undefined, label: "All" },
  { view: "day", label: "Last 24 hours" },
  { view: "unreplied", label: "Not replied" },
  { view: "replied", label: "Replied" },
  { view: "pictures", label: "With pictures" },
];

/** Posts from the people Luke picks on X, and his replies to them. */
export default async function XFeedPage({ searchParams }: PageProps<"/x">) {
  const { person, company, view, before } = await searchParams;
  const personId = typeof person === "string" && /^[0-9a-f-]{36}$/.test(person) ? person : undefined;
  const companyName = typeof company === "string" && company.trim() ? company.trim() : undefined;
  const shownView = feedViews.find((v) => v === view);
  const older = typeof before === "string" && !Number.isNaN(Date.parse(before)) ? before : undefined;
  const feed = await getFeed({ personId, company: companyName, view: shownView, before: older });
  const now = feed.now.getTime();
  const picked = personId ? feed.people.find((p) => p.id === personId) : undefined;

  const href = (change: { view?: FeedView; company?: string; person?: string; before?: string }) => {
    const next = { view: shownView, company: companyName, person: personId, ...change };
    const params = new URLSearchParams(Object.entries(next).filter((e): e is [string, string] => !!e[1]));
    const qs = params.toString();
    return qs ? `/x?${qs}` : "/x";
  };

  return (
    <Page
      title="X feed"
      eyebrow={feed.checkedAt ? `Checked ${ago(feed.checkedAt.getTime(), now)} ago` : undefined}
      newTask={false}
      actions={<PeopleButton people={feed.people} />}
    >
      <div className="flex w-full max-w-2xl flex-col gap-3 md:mx-auto">
        {feed.people.length > 0 && (
          <nav aria-label="Show" className={row}>
            {views.map((v) => (
              <Link key={v.label} href={href({ view: v.view })} scroll={false} aria-current={shownView === v.view || undefined} className={cn(chip, shownView === v.view ? on : off)}>
                {v.label}
              </Link>
            ))}
          </nav>
        )}
        {(feed.companies.length > 1 || picked) && (
          <nav aria-label="Companies" className={row}>
            {picked && (
              <Link href={href({ person: undefined })} scroll={false} aria-label={`Stop showing only ${picked.name || picked.handle}`} className={cn(chip, on)}>
                {picked.name || `@${picked.handle}`}
                <X className="size-3.5" aria-hidden />
              </Link>
            )}
            {feed.companies.map((c) => {
              const active = companyName?.toLowerCase() === c.toLowerCase();
              return (
                <Link key={c} href={href({ company: active ? undefined : c })} scroll={false} aria-current={active || undefined} className={cn(chip, active ? on : off)}>
                  {c}
                </Link>
              );
            })}
          </nav>
        )}
        <XFeed
          key={`${personId}-${companyName}-${shownView}-${older}`}
          posts={feed.posts}
          now={now}
          hasPeople={feed.people.length > 0}
          filtered={!!(personId || companyName || shownView)}
        />
        {feed.more && (
          <Link
            href={href({ before: feed.more })}
            className="self-center rounded-lg border border-stroke bg-card px-4 py-2.5 text-control text-subtle-foreground hover:bg-muted"
          >
            Older posts
          </Link>
        )}
      </div>
    </Page>
  );
}

function ago(at: number, now: number) {
  const m = Math.max(1, Math.round((now - at) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}
