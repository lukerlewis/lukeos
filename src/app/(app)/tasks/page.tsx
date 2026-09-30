import type { Metadata } from "next";
import { EmptyState, Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "All tasks · LukeOS" };

export default function TasksPage() {
  return (
    <Page title="All tasks">
      <Card>
        <EmptyState>Your tasks from every project will show here.</EmptyState>
      </Card>
    </Page>
  );
}
