import type { Metadata } from "next";
import { EmptyState, Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Notes · LukeOS" };

export default function NotesPage() {
  return (
    <Page title="Notes">
      <Card>
        <EmptyState>Your notes will show here.</EmptyState>
      </Card>
    </Page>
  );
}
