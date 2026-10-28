import type { Metadata } from "next";
import { DocumentList } from "@/components/documents/document-list";
import { NewDocumentButton, NewDocumentFab } from "@/components/documents/new-document-button";
import { PinnedRow } from "@/components/pinned/pinned-row";
import { MarkFromClaudeSeen } from "@/components/from-claude/mark-seen";
import { EmptyState, Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { chipProjects, countByProject, pickedFromQuery, ProjectChips, withProjects } from "@/components/ui/project-chips";
import { listDocuments } from "@/core/documents";
import { listProjects } from "@/core/projects";
import { getTimeZone } from "@/core/settings";
import { pinnedDocument } from "@/lib/pinned";

export const metadata: Metadata = { title: "Documents · LukeOS" };

const filters = [
  { value: undefined, label: "All" },
  { value: "me", label: "Made by me" },
  { value: "claude", label: "Made by Claude" },
] as const;

export default async function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  const query = await searchParams;
  const by = query.by === "me" || query.by === "claude" ? query.by : undefined;
  const [all, timeZone, projects] = await Promise.all([
    listDocuments({ madeBy: by === "me" ? "luke" : by }),
    getTimeZone(),
    listProjects(),
  ]);
  const picked = pickedFromQuery(query.project, projects);
  // A new document gets the project when exactly one is picked.
  const only = picked.length === 1 ? picked[0] : null;
  const documents = picked.length ? all.filter((d) => d.project && picked.includes(d.project.id)) : all;
  // Pinned documents sit in their own row on top, not in the list below.
  const pinned = documents.filter((d) => d.pinned);
  const rest = documents.filter((d) => !d.pinned);

  return (
    <Page title="Documents" actions={<NewDocumentButton projectId={only} className="max-md:hidden" />} newTask={false}>
      {/* Opening Documents clears the New count on Claude's documents. */}
      <MarkFromClaudeSeen hasNew={documents.some((d) => d.isNew)} />
      <div className="flex max-w-3xl flex-col gap-4">
        <SegmentedLinks
          label="Made by"
          className="max-w-full self-start overflow-x-auto"
          options={filters.map((f) => ({
            href: withProjects("/documents", { by: f.value }, picked),
            label: f.label,
            active: by === f.value,
          }))}
        />
        <ProjectChips
          projects={chipProjects(projects)}
          counts={countByProject(all.map((d) => d.project?.id))}
          total={all.length}
          picked={picked}
          href={(ids) => withProjects("/documents", { by }, ids)}
          className="-mx-5 flex-nowrap overflow-x-auto px-5 md:mx-0 md:flex-wrap md:px-0"
        />
        <PinnedRow items={pinned.map(pinnedDocument)} />
        {(rest.length > 0 || pinned.length === 0) && (
          <Card>
            <DocumentList
              documents={rest}
              timeZone={timeZone}
              empty={<EmptyState>{by === "claude" ? "Nothing from Claude yet." : "No documents yet."}</EmptyState>}
            />
          </Card>
        )}
      </div>
      <NewDocumentFab projectId={only} />
    </Page>
  );
}
