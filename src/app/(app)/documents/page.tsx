import type { Metadata } from "next";
import { DocumentList } from "@/components/documents/document-list";
import { NewDocumentButton, NewDocumentFab } from "@/components/documents/new-document-button";
import { MarkFromClaudeSeen } from "@/components/from-claude/mark-seen";
import { EmptyState, Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { listDocuments } from "@/core/documents";
import { getTimeZone } from "@/core/settings";

export const metadata: Metadata = { title: "Documents · LukeOS" };

const filters = [
  { value: undefined, label: "All" },
  { value: "me", label: "Made by me" },
  { value: "claude", label: "Made by Claude" },
] as const;

export default async function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  const query = await searchParams;
  const by = query.by === "me" || query.by === "claude" ? query.by : undefined;
  const [documents, timeZone] = await Promise.all([
    listDocuments({ madeBy: by === "me" ? "luke" : by }),
    getTimeZone(),
  ]);

  return (
    <Page title="Documents" actions={<NewDocumentButton className="max-md:hidden" />} newTask={false}>
      {/* Opening Documents clears the New count on Claude's documents. */}
      <MarkFromClaudeSeen hasNew={documents.some((d) => d.isNew)} />
      <div className="flex max-w-3xl flex-col gap-4">
        <SegmentedLinks
          label="Made by"
          className="max-w-full self-start overflow-x-auto"
          options={filters.map((f) => ({
            href: f.value ? `/documents?by=${f.value}` : "/documents",
            label: f.label,
            active: by === f.value,
          }))}
        />
        <Card>
          <DocumentList
            documents={documents}
            timeZone={timeZone}
            empty={<EmptyState>{by === "claude" ? "Nothing from Claude yet." : "No documents yet."}</EmptyState>}
          />
        </Card>
      </div>
      <NewDocumentFab />
    </Page>
  );
}
