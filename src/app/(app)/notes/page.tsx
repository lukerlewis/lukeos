import type { Metadata } from "next";
import Link from "next/link";
import { NewNoteButton } from "@/components/notes/new-note-button";
import { NoteList } from "@/components/notes/note-list";
import { EmptyState, Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { listNotes } from "@/core/notes";
import { getTimeZone } from "@/core/settings";

export const metadata: Metadata = { title: "Notes · LukeOS" };

export default async function NotesPage() {
  // Notes Claude writes live in Agents, so this is just Luke's own.
  const [notes, timeZone] = await Promise.all([listNotes({ madeBy: "luke" }), getTimeZone()]);

  return (
    <Page title="Notes" actions={<NewNoteButton />} newTask={false}>
      <div className="flex max-w-3xl flex-col gap-5">
        <p className="text-[13px] text-muted-foreground">
          Your notes. Notes Claude writes are in{" "}
          <Link href="/agents?type=note" className="underline underline-offset-2">
            Agents
          </Link>
          .
        </p>
        <Card>
          <NoteList
            notes={notes}
            timeZone={timeZone}
            empty={
              <EmptyState>No notes yet. A note can stand on its own or sit inside a project.</EmptyState>
            }
          />
        </Card>
      </div>
    </Page>
  );
}
