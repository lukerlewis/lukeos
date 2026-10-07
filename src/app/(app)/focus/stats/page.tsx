import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { FocusChart } from "@/components/focus/focus-chart";
import { Page } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { focusByDay } from "@/core/focus";
import { duration } from "@/lib/focus";

export const metadata: Metadata = { title: "Focus stats · LukeOS" };

const ranges = [7, 30] as const;

/** Focus time per day: pomodoro focus rounds and the regular timer. */
export default async function FocusStatsPage({ searchParams }: PageProps<"/focus/stats">) {
  const { range } = await searchParams;
  const days = range === "30" ? 30 : 7;
  const { today, days: list, totalSeconds } = await focusByDay(days);

  return (
    <Page
      title="Stats"
      newTask={false}
      eyebrow={
        <Link href="/focus" className="-ml-1 inline-flex items-center hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          Focus
        </Link>
      }
    >
      <div className="flex w-full max-w-2xl flex-col gap-4 md:mx-auto">
        <SegmentedLinks
          label="Range"
          className="flex w-full [&>a]:grow [&>a]:justify-center"
          options={ranges.map((n) => ({ href: n === 7 ? "/focus/stats" : `/focus/stats?range=${n}`, label: `${n} days`, active: n === days }))}
        />
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Today" value={duration(list.at(-1)?.seconds ?? 0)} />
          <Stat label={`${days} days`} value={duration(totalSeconds)} />
          <Stat label="Average" value={duration(totalSeconds / days)} />
        </div>
        <Card className="px-4 pt-5 pb-4">
          <FocusChart days={list} today={today} />
        </Card>
      </div>
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-1 px-4 py-3">
      <span className="text-meta text-muted-foreground">{label}</span>
      <span className="text-heading font-medium text-ink tabular-nums">{value}</span>
    </Card>
  );
}
