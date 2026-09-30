import type { Metadata } from "next";
import { EmptyState, Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Search · LukeOS" };

export default function SearchPage() {
  return (
    <Page title="Search">
      <Card>
        <EmptyState>Search arrives in a later step.</EmptyState>
      </Card>
    </Page>
  );
}
