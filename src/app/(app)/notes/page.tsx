import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { EditFolderButton, NewFolderButton } from "@/components/notes/folder-dialog";
import { FolderList } from "@/components/notes/folder-list";
import { NewNoteButton, NewNoteFab } from "@/components/notes/new-note-button";
import { NoteList } from "@/components/notes/note-list";
import { EmptyState, Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { listFolders } from "@/core/folders";
import { listNotes } from "@/core/notes";
import { listProjects } from "@/core/projects";
import { getTimeZone } from "@/core/settings";

export const metadata: Metadata = { title: "Notes · LukeOS" };

export default async function NotesPage({ searchParams }: PageProps<"/notes">) {
  const query = await searchParams;
  const folderId = typeof query.folder === "string" && /^[0-9a-f-]{36}$/i.test(query.folder) ? query.folder : null;
  if (query.folder && !folderId) notFound();

  // Notes are Luke's own writing. What Claude makes on its own is an artifact, in Agents.
  // The main list shows folders, then the notes that aren't in one.
  const [folders, notes, projects, timeZone] = await Promise.all([
    listFolders(),
    listNotes({ folderId }),
    listProjects(),
    getTimeZone(),
  ]);
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));

  if (folderId) {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) notFound();
    return (
      <Page
        title={folder.name}
        eyebrow={
          <Link href="/notes" className="-ml-1 inline-flex items-center hover:text-foreground">
            <ChevronLeft className="size-4" aria-hidden />
            Notes
          </Link>
        }
        actions={
          <>
            <EditFolderButton
              folder={{ id: folder.id, name: folder.name, projectId: folder.project?.id ?? null }}
              projects={projectOptions}
            />
            <NewNoteButton folderId={folder.id} className="max-md:hidden" />
          </>
        }
        newTask={false}
      >
        <div className="flex max-w-3xl flex-col gap-5">
          {folder.project && (
            <Link
              href={`/projects/${folder.project.id}?view=notes`}
              className="-mt-3 inline-flex items-center gap-1.5 self-start text-[13px] text-muted-foreground hover:text-foreground"
            >
              <span className="size-2 rounded-[3px]" style={{ background: folder.project.hex }} aria-hidden />
              {folder.project.name}
            </Link>
          )}
          <Card>
            <NoteList notes={notes} timeZone={timeZone} empty={<EmptyState>No notes in this folder yet.</EmptyState>} />
          </Card>
        </div>
        <NewNoteFab folderId={folder.id} />
      </Page>
    );
  }

  return (
    <Page
      title="Notes"
      actions={
        <>
          <NewFolderButton projects={projectOptions} />
          <NewNoteButton className="max-md:hidden" />
        </>
      }
      newTask={false}
    >
      <div className="flex max-w-3xl flex-col gap-5">
        {folders.length > 0 && (
          <Card>
            <FolderList folders={folders} />
          </Card>
        )}
        {(notes.length > 0 || folders.length === 0) && (
          <Card>
            <NoteList notes={notes} timeZone={timeZone} empty={<EmptyState>No notes yet.</EmptyState>} />
          </Card>
        )}
      </div>
      <NewNoteFab />
    </Page>
  );
}
