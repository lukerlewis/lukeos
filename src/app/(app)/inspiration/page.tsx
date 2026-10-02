import type { Metadata } from "next";
import { AddButton } from "@/components/inspiration/add";
import { InspirationBoard } from "@/components/inspiration/board";
import { SearchBox, TagChips } from "@/components/inspiration/filters";
import { EmptyState, Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { getInspiration, inspirationTags, listInspiration, type InspirationItem } from "@/core/inspiration";
import { listProjects } from "@/core/projects";
import { inspirationKinds, kindPlural, type InspirationKind } from "@/lib/inspiration";
import { storageUsage } from "@/lib/storage";
import { StorageNotice } from "@/components/inspiration/storage-notice";

export const metadata: Metadata = { title: "Inspiration · LukeOS" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export default async function InspirationPage({ searchParams }: PageProps<"/inspiration">) {
  const query = await searchParams;
  const q = one(query.q) ?? "";
  const tag = one(query.tag) ?? null;
  const kind = inspirationKinds.find((k) => k === one(query.kind)) as InspirationKind | undefined;
  const itemId = one(query.item);

  const [items, tags, projects, usage] = await Promise.all([
    listInspiration({ search: q, tag: tag ?? undefined, kind }),
    inspirationTags(),
    listProjects(),
    storageUsage(),
  ]);
  let openItem: InspirationItem | null = null;
  if (itemId && /^[0-9a-f-]{36}$/i.test(itemId)) openItem = items.find((i) => i.id === itemId) ?? (await getInspiration(itemId).catch(() => null));

  const href = (change: { q?: string; tag?: string | null; kind?: InspirationKind | null }) => {
    const params = new URLSearchParams();
    const next = { q, tag, kind: kind ?? null, ...change };
    if (next.q) params.set("q", next.q);
    if (next.tag) params.set("tag", next.tag);
    if (next.kind) params.set("kind", next.kind);
    const s = params.toString();
    return s ? `/inspiration?${s}` : "/inspiration";
  };
  const filtered = Boolean(q || tag || kind);

  return (
    <Page title="Inspiration" newTask={false}>
      <InspirationBoard
        items={items}
        projects={projects.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
        openItem={openItem}
        empty={
          <Card className="max-w-3xl">
            <EmptyState>{filtered ? "Nothing matches." : "Nothing saved yet."}</EmptyState>
          </Card>
        }
      >
        {usage.warn && <StorageNotice used={usage.used} limit={usage.limit} full={usage.full} />}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <SearchBox query={q} />
            <span className="grow max-md:hidden" />
            <AddButton className="max-md:hidden" />
          </div>
          <div className="-mx-5 overflow-x-auto px-5 md:mx-0 md:px-0">
            <SegmentedLinks
              label="Show"
              options={[
                { href: href({ kind: null }), label: "All", active: !kind },
                ...inspirationKinds.map((k) => ({ href: href({ kind: k }), label: kindPlural[k], active: kind === k })),
              ]}
            />
          </div>
          <TagChips tags={tags.slice(0, 30)} active={tag} />
        </div>
      </InspirationBoard>
    </Page>
  );
}
