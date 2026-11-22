import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { HealthDetail } from "@/components/health/health-detail";
import { Page } from "@/components/shell/page";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { getHealth } from "@/core/health";
import { sectionById, sectionHref } from "@/lib/health-sections";

const ranges = [7, 30, 90] as const;

export async function generateMetadata({ params }: PageProps<"/health/[section]">): Promise<Metadata> {
  const { section } = await params;
  return { title: `${sectionById(section)?.title ?? "Health"} · LukeOS` };
}

/** One Health number over 7, 30 or 90 days, with a day picked for its within-the-day detail. */
export default async function HealthSectionPage({ params, searchParams }: PageProps<"/health/[section]">) {
  const { section: id } = await params;
  const section = sectionById(id);
  if (!section) notFound();
  const { range, date } = await searchParams;
  const days = range === "7" ? 7 : range === "90" ? 90 : 30;
  const health = await getHealth(days);
  if (!health.connected) redirect("/health");
  const picked = typeof date === "string" ? date : undefined;

  return (
    <Page title={section.title} newTask={false} eyebrow={<Link href="/health" className="hover:text-foreground">Health</Link>}>
      <div className="flex w-full max-w-2xl flex-col gap-4 md:mx-auto">
        <SegmentedLinks
          label="Range"
          className="flex w-full [&>a]:grow [&>a]:justify-center"
          options={ranges.map((n) => ({ href: sectionHref(id, picked, n), label: `${n} days`, active: n === days }))}
        />
        <HealthDetail key={`${id}-${days}`} sectionId={id} days={health.days} today={health.today} timeZone={health.timeZone} initialDate={picked} range={days} />
      </div>
    </Page>
  );
}
