import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { HealthConnect } from "@/components/health/health-connect";
import { Page } from "@/components/shell/page";
import { healthStatus, redirectUri } from "@/core/health-google";

export const metadata: Metadata = { title: "Connect Fitbit · LukeOS" };

/** Google client ID and secret, then Google sign-in. Also where Fitbit is disconnected. */
export default async function HealthConnectPage({ searchParams }: PageProps<"/health/connect">) {
  const { error } = await searchParams;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const status = await healthStatus();
  return (
    <Page
      title="Fitbit"
      newTask={false}
      eyebrow={
        <Link href="/health" className="-ml-1 inline-flex items-center hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          Health
        </Link>
      }
    >
      <HealthConnect status={status} redirectUri={redirectUri(origin)} error={typeof error === "string" ? error : null} />
    </Page>
  );
}
