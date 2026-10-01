import type { Metadata } from "next";
import { NewNoteButton, NewNoteFab } from "@/components/notes/new-note-button";
import { NoteList } from "@/components/notes/note-list";
import { EmptyState, Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { listNotes } from "@/core/notes";
import { getTimeZone } from "@/core/settings";

export const metadata: Metadata = { title: "Notes · LukeOS" };

export default async function NotesPage() {
  // Notes are Luke's own writing. What Claude makes on its own is an artifact, in Agents.
  const [notes, timeZone] = await Promise.all([listNotes(), getTimeZone()]);

  return (
    <Page title="Notes" actions={<NewNoteButton className="max-md:hidden" />} newTask={false}>
      <div className="flex max-w-3xl flex-col gap-5">
        <Card>
          <NoteList
            notes={notes}
            timeZone={timeZone}
            empty={<EmptyState>No notes yet.</EmptyState>}
          />
        </Card>
      </div>
      <NewNoteFab />
    </Page>
  );
}
