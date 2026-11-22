import type { Metadata } from "next";
import { Check } from "lucide-react";
import Link from "next/link";
import { Page } from "@/components/shell/page";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { healthStatus } from "@/core/health-google";

export const metadata: Metadata = { title: "Fitbit connected · LukeOS" };

/** Where Google sign-in ends. The iPhone app closes its sign-in sheet when it lands here. */
export default async function HealthConnectedPage() {
  const status = await healthStatus();
  return (
    <Page title="Health" newTask={false}>
      <Card className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-6 py-10 text-center">
        <Check className="size-6" aria-hidden />
        <span className="text-control font-medium">Fitbit connected</span>
        {status.lastError && <span className="text-meta text-muted-foreground">{status.lastError}</span>}
        <Link href="/health" className={buttonVariants()}>Open Health</Link>
      </Card>
    </Page>
  );
}
