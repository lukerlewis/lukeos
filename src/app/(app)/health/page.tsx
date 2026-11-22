import type { Metadata } from "next";
import { HeartPulse } from "lucide-react";
import Link from "next/link";
import { HealthScreen } from "@/components/health/health-screen";
import { Page } from "@/components/shell/page";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { getHealth } from "@/core/health";

export const metadata: Metadata = { title: "Health · LukeOS" };

const ranges = [7, 30] as const;

/** Luke's Fitbit numbers: sleep, steps, heart and workouts. */
export default async function HealthPage({ searchParams }: PageProps<"/health">) {
  const { range } = await searchParams;
  const days = range === "30" ? 30 : 7;
  const health = await getHealth(days);

  return (
    <Page title="Health" newTask={false} actions={health.connected && <Link href="/health/connect" className={buttonVariants({ variant: "outline", size: "sm" })}>Fitbit</Link>}>
      <div className="flex w-full max-w-2xl flex-col gap-4 md:mx-auto">
        {health.connected ? (
          <>
            <SegmentedLinks
              label="Range"
              className="flex w-full [&>a]:grow [&>a]:justify-center"
              options={ranges.map((n) => ({ href: n === 7 ? "/health" : `/health?range=${n}`, label: `${n} days`, active: n === days }))}
            />
            <HealthScreen key={days} days={health.days} today={health.today} timeZone={health.timeZone} lastSyncAt={health.lastSyncAt} lastError={health.lastError} />
          </>
        ) : (
          <Card className="flex flex-col items-center gap-4 px-6 py-10 text-center">
            <HeartPulse className="size-6 text-muted-foreground" aria-hidden />
            <span className="text-control text-muted-foreground">{health.lastError ?? "Fitbit isn't connected."}</span>
            <Link href="/health/connect" className={buttonVariants()}>Connect Fitbit</Link>
          </Card>
        )}
      </div>
    </Page>
  );
}
