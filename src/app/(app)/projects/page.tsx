import type { Metadata } from "next";
import { EmptyState, Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Projects · LukeOS" };

export default function ProjectsPage() {
  return (
    <Page title="Projects">
      <Card>
        <EmptyState>Your projects will show here.</EmptyState>
      </Card>
    </Page>
  );
}
