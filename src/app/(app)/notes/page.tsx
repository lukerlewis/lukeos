import type { Metadata } from "next";
import { NewNoteButton } from "@/components/notes/new-note-button";
import { NoteList } from "@/components/notes/note-list";
import { EmptyState, Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { listNotes } from "@/core/notes";
import { getTimeZone } from "@/core/settings";

export const metadata: Metadata = { title: "Notes · LukeOS" };

export default async function NotesPage({ searchParams }: PageProps<"/notes">) {
  const { by } = await searchParams;
  const madeBy = by === "luke" || by === "claude" ? by : undefined;
  const [notes, timeZone] = await Promise.all([listNotes({ madeBy }), getTimeZone()]);

  return (
    <Page title="Notes" actions={<NewNoteButton />} newTask={false}>
      <div className="flex max-w-3xl flex-col gap-5">
        <SegmentedLinks
          label="Made by"
          className="self-start"
          options={[
            { href: "/notes", label: "All", active: !madeBy },
            { href: "/notes?by=luke", label: "Mine", active: madeBy === "luke" },
            { href: "/notes?by=claude", label: "Claude's", active: madeBy === "claude" },
          ]}
        />
        <Card>
          <NoteList
            notes={notes}
            timeZone={timeZone}
            empty={
              <EmptyState>
                {madeBy === "claude"
                  ? "Nothing from Claude yet. Documents your routines save will show here."
                  : "No notes yet. A note can stand on its own or sit inside a project."}
              </EmptyState>
            }
          />
        </Card>
      </div>
    </Page>
  );
}
