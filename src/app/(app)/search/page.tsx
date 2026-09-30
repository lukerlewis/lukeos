import type { Metadata } from "next";
import { CommandPanel } from "@/components/command/command-menu";
import { Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Search · LukeOS" };

/** The phone's Search tab: the same search and commands as ⌘K, as a page. */
export default function SearchPage() {
  return (
    <Page title="Search" newTask={false}>
      <Card className="max-w-2xl">
        <CommandPanel />
      </Card>
    </Page>
  );
}
