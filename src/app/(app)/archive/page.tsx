import type { Metadata } from "next";
import { NewEntryButton, NewEntryFab } from "@/components/archive/new-entry-button";
import { EntryGrid } from "@/components/archive/entry-grid";
import { EmptyState, Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { listEntries } from "@/core/archive";
import { entrySizes, sizePlural, type EntrySize } from "@/lib/archive";

export const metadata: Metadata = { title: "Work archive · LukeOS" };

export default async function ArchivePage({ searchParams }: PageProps<"/archive">) {
  const query = await searchParams;
  const size = entrySizes.find((s) => s === query.size) as EntrySize | undefined;
  const entries = await listEntries({ size });

  return (
    <Page title="Work archive" actions={<NewEntryButton size={size} className="max-md:hidden" />} newTask={false}>
      <div className="-mx-5 overflow-x-auto px-5 md:mx-0 md:px-0">
        <SegmentedLinks
          label="Show"
          options={[
            { href: "/archive", label: "All", active: !size },
            ...entrySizes.map((s) => ({ href: `/archive?size=${s}`, label: sizePlural[s], active: size === s })),
          ]}
        />
      </div>
      {entries.length === 0 ? (
        <Card className="max-w-3xl">
          <EmptyState>{size ? `No ${sizePlural[size].toLowerCase()} yet.` : "Nothing in the archive yet."}</EmptyState>
        </Card>
      ) : (
        <EntryGrid entries={entries} />
      )}
      <NewEntryFab size={size} />
    </Page>
  );
}
