import type { Metadata } from "next";
import { headers } from "next/headers";
import { PortfolioText } from "@/components/portfolio/portfolio-text";
import { PortfolioWorkList } from "@/components/portfolio/work-list";
import { PromptList } from "@/components/portfolio/prompt-list";
import { PublishButton } from "@/components/portfolio/publish-button";
import { PortfolioSetup } from "@/components/portfolio/setup";
import { Page } from "@/components/shell/page";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { getPortfolioText, listPortfolioEntries, listPrompts, portfolioStatus, promptCount } from "@/core/portfolio";
import { getTimeZone } from "@/core/settings";
import { portfolioTabLabel, portfolioTabs, type PortfolioTab } from "@/lib/portfolio";
import { hasPortfolioKey } from "@/lib/portfolio-key";

export const metadata: Metadata = { title: "Portfolio · LukeOS" };

/**
 * Luke's portfolio site, run from here: what visitors ask its AI, the work
 * it shows, the AI's instructions and what it knows about Luke. Publish
 * sends the last three to the site.
 */
export default async function PortfolioPage({ searchParams }: PageProps<"/portfolio">) {
  const query = await searchParams;
  const tab = portfolioTabs.find((t) => t === query.tab) ?? "prompts";
  const search = typeof query.q === "string" ? query.q : undefined;
  const status = await portfolioStatus();

  return (
    <Page title="Portfolio" newTask={false} actions={<PublishButton status={status} />}>
      <div className="-mx-5 overflow-x-auto px-5 md:mx-0 md:px-0">
        <SegmentedLinks
          label="Show"
          options={portfolioTabs.map((t) => ({ href: t === "prompts" ? "/portfolio" : `/portfolio?tab=${t}`, label: portfolioTabLabel[t], active: tab === t }))}
        />
      </div>
      <Tab tab={tab} search={search} />
    </Page>
  );
}

async function Tab({ tab, search }: { tab: PortfolioTab; search?: string }) {
  switch (tab) {
    case "prompts": {
      const [prompts, total, timeZone, connected] = await Promise.all([listPrompts({ search, limit: 200 }), promptCount(), getTimeZone(), hasPortfolioKey()]);
      return <PromptList prompts={prompts} total={total} search={search} timeZone={timeZone} connected={connected} />;
    }
    case "work":
      return <PortfolioWorkList entries={await listPortfolioEntries()} />;
    case "instructions":
    case "about": {
      const text = await getPortfolioText();
      return <PortfolioText key={tab} field={tab} initial={tab === "about" ? text.about : text.instructions} />;
    }
    case "setup": {
      const h = await headers();
      const host = h.get("x-forwarded-host") ?? h.get("host");
      const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
      const status = await portfolioStatus();
      return <PortfolioSetup hasKey={await hasPortfolioKey()} origin={`${proto}://${host}`} canPublish={status.canPublish} repo={status.repo} />;
    }
  }
}
