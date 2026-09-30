import type { Metadata } from "next";
import { EmptyState, Page } from "@/components/shell/page";
import { EmptyTrashButton, TrashList } from "@/components/trash/trash-list";
import { Card } from "@/components/ui/card";
import { getTimeZone } from "@/core/settings";
import { listTrash, TRASH_DAYS } from "@/core/trash";

export const metadata: Metadata = { title: "Trash · LukeOS" };

export default async function TrashPage() {
  const [items, timeZone] = await Promise.all([listTrash(), getTimeZone()]);

  return (
    <Page title="Trash" actions={items.length > 0 && <EmptyTrashButton count={items.length} />} newTask={false}>
      <div className="flex max-w-3xl flex-col gap-4">
        <p className="text-[13px] text-muted-foreground">
          Deleted things stay here for {TRASH_DAYS} days, then they&apos;re gone for good. Restore puts them back where
          they were.
        </p>
        <Card>
          {items.length === 0 ? (
            <EmptyState>Trash is empty.</EmptyState>
          ) : (
            <TrashList items={items} timeZone={timeZone} />
          )}
        </Card>
      </div>
    </Page>
  );
}
