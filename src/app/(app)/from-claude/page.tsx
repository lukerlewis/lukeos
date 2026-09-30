import type { Metadata } from "next";
import { ClaudeItemList } from "@/components/from-claude/item-list";
import { MarkFromClaudeSeen } from "@/components/from-claude/mark-seen";
import { editedLabel } from "@/components/notes/note-list";
import { EmptyState, Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { claudeRoutines, listFromClaude, type ClaudeItem } from "@/core/from-claude";
import { getTimeZone } from "@/core/settings";

export const metadata: Metadata = { title: "From Claude · LukeOS" };

const types = [
  { value: undefined, label: "Everything" },
  { value: "note", label: "Notes" },
  { value: "task", label: "Tasks" },
  { value: "project", label: "Projects" },
] as const;

export default async function FromClaudePage({ searchParams }: PageProps<"/from-claude">) {
  const query = await searchParams;
  const type = types.find((t) => t.value && t.value === query.type)?.value as ClaudeItem["type"] | undefined;
  const routine = typeof query.routine === "string" && query.routine ? query.routine : undefined;
  const [items, routines, timeZone] = await Promise.all([
    listFromClaude({ type, routine, limit: 200 }),
    claudeRoutines(),
    getTimeZone(),
  ]);
  const href = (next: { type?: string; routine?: string }) => {
    const params = new URLSearchParams();
    if (next.type) params.set("type", next.type);
    if (next.routine) params.set("routine", next.routine);
    const qs = params.toString();
    return qs ? `/from-claude?${qs}` : "/from-claude";
  };
  const when = Object.fromEntries(items.map((i) => [i.id, editedLabel(i.createdAt, timeZone)]));

  return (
    <Page title="From Claude" newTask={false}>
      <MarkFromClaudeSeen hasNew={items.some((i) => i.isNew)} />
      <div className="flex max-w-3xl flex-col gap-4">
        <p className="text-[13px] text-muted-foreground">
          Everything Claude has made for you, newest first. Blue dots are new since you last looked.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedLinks
            label="Type"
            options={types.map((t) => ({ href: href({ type: t.value, routine }), label: t.label, active: type === t.value }))}
          />
          {routines.length > 0 && (
            <SegmentedLinks
              label="Routine"
              className="max-w-full overflow-x-auto"
              options={[
                { href: href({ type }), label: "Any routine", active: !routine },
                ...routines.map((r) => ({ href: href({ type, routine: r }), label: r, active: routine === r })),
              ]}
            />
          )}
        </div>
        <Card>
          {items.length === 0 ? (
            <EmptyState>
              Nothing here yet. When Claude or one of your routines saves something to LukeOS, it lands here.
            </EmptyState>
          ) : (
            <ClaudeItemList items={items} when={when} />
          )}
        </Card>
      </div>
    </Page>
  );
}
