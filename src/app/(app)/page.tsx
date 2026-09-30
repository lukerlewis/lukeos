import { Greeting, TodayDate } from "@/components/greeting";
import { EmptyState, Page } from "@/components/shell/page";
import { Card, CardHeader } from "@/components/ui/card";

export default function TodayPage() {
  return (
    <Page title="Today" eyebrow={<TodayDate />} heading={<Greeting />}>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Due today" aside="0 tasks" />
            <EmptyState>Nothing due today. Tasks arrive in the next step.</EmptyState>
          </Card>
          <Card>
            <CardHeader title="Coming up" />
            <EmptyState>Nothing coming up yet.</EmptyState>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Recent notes" />
            <EmptyState>No notes yet.</EmptyState>
          </Card>
          <Card>
            <CardHeader title="Projects" />
            <EmptyState>No projects yet.</EmptyState>
          </Card>
        </div>
      </div>
    </Page>
  );
}
