import type { Metadata } from "next";
import Link from "next/link";
import { PeopleButton } from "@/components/x-feed/people";
import { XFeed } from "@/components/x-feed/feed";
import { Page } from "@/components/shell/page";
import { getFeed } from "@/core/x-feed";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "X feed · LukeOS" };

const chip = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-meta whitespace-nowrap";
const on = "bg-selected font-medium text-ink";
const off = "border bg-card text-muted-foreground hover:bg-muted";

/** Posts from the people Luke picks on X, and his replies to them. */
export default async function XFeedPage({ searchParams }: PageProps<"/x">) {
  const { person, before } = await searchParams;
  const personId = typeof person === "string" && /^[0-9a-f-]{36}$/.test(person) ? person : undefined;
  const older = typeof before === "string" && !Number.isNaN(Date.parse(before)) ? before : undefined;
  const feed = await getFeed({ personId, before: older });
  const now = feed.now.getTime();

  return (
    <Page
      title="X feed"
      eyebrow={feed.checkedAt ? `Checked ${ago(feed.checkedAt.getTime(), now)} ago` : undefined}
      newTask={false}
      actions={<PeopleButton people={feed.people} />}
    >
      <div className="flex w-full max-w-2xl flex-col gap-4 md:mx-auto">
        {feed.people.length > 1 && (
          <nav aria-label="People" className="-mx-5 flex gap-1.5 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:px-0">
            <Link href="/x" scroll={false} aria-current={!personId || undefined} className={cn(chip, !personId ? on : off)}>
              Everyone
            </Link>
            {feed.people.map((p) => (
              <Link key={p.id} href={`/x?person=${p.id}`} scroll={false} aria-current={personId === p.id || undefined} className={cn(chip, personId === p.id ? on : off)}>
                {p.name || `@${p.handle}`}
              </Link>
            ))}
          </nav>
        )}
        <XFeed key={`${personId}-${older}`} posts={feed.posts} now={now} hasPeople={feed.people.length > 0} />
        {feed.more && (
          <Link
            href={`/x?${new URLSearchParams({ ...(personId && { person: personId }), before: feed.more })}`}
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
