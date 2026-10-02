import { asc, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { ChevronRight, Trash2 } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { PushSettings } from "@/components/messages/push-toggle";
import { Page } from "@/components/shell/page";
import { Card, CardHeader } from "@/components/ui/card";
import { pushDeviceCount } from "@/core/push";
import { trashCount } from "@/core/trash";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { CopyAddress, DisconnectButton } from "./claude";
import { ShortcutKey } from "./shortcut";
import { StorageMeter } from "@/components/inspiration/storage-notice";
import { storageUsage } from "@/lib/storage";
import { hasShortcutKey } from "@/lib/shortcut-key";
import { AddDeviceButton, RemoveDeviceButton, SignOutButton } from "./devices";
import { ThemeSwitch } from "./theme-switch";

export const metadata: Metadata = { title: "Settings · LukeOS" };

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function SettingsPage() {
  const session = await requireSession();
  const passkeys = await db.select().from(schema.passkeys).orderBy(asc(schema.passkeys.createdAt));
  const connections = await db
    .select()
    .from(schema.agentConnections)
    .where(isNull(schema.agentConnections.revokedAt))
    .orderBy(asc(schema.agentConnections.createdAt));
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const connectorAddress = `${proto}://${host}/api/mcp`;
  const [inTrash, pushDevices, usage, shortcutKey] = await Promise.all([trashCount(), pushDeviceCount(), storageUsage(), hasShortcutKey()]);

  return (
    <Page title="Settings" newTask={false}>
      <div className="flex max-w-2xl flex-col gap-6">
        <Card>
          <CardHeader title="Appearance" />
          <div className="flex flex-col gap-3 px-4 py-4">
            <ThemeSwitch />
          </div>
        </Card>

        <Card>
          <CardHeader title="Notifications" />
          <PushSettings devices={pushDevices} />
        </Card>

        <Card>
          <CardHeader title="Devices that can sign in" aside={`${passkeys.length}`} />
          <ul>
            {passkeys.map((p) => (
              <li key={p.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
                <div className="flex grow flex-col gap-0.5">
                  <span className="font-medium">
                    {p.deviceName}
                    {p.id === session.passkeyId && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">This device</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Added {dateFmt.format(p.createdAt)}
                    {p.lastUsedAt && ` · last used ${dateFmt.format(p.lastUsedAt)}`}
                  </span>
                </div>
                {passkeys.length > 1 && <RemoveDeviceButton id={p.id} name={p.deviceName} />}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 border-t px-4 py-4">
            <AddDeviceButton />
          </div>
        </Card>

        <Card>
          <CardHeader title="Claude" aside={connections.length ? `${connections.length} connected` : undefined} />
          <div className="flex flex-col gap-3 px-4 py-4">
            <p className="text-[13px] text-muted-foreground">
              Add as a custom connector in Claude&apos;s settings.
            </p>
            <CopyAddress address={connectorAddress} />
          </div>
          {connections.length > 0 && (
            <ul className="border-t">
              {connections.map((c) => (
                <li key={c.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
                  <div className="flex grow flex-col gap-0.5">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      Connected {dateFmt.format(c.createdAt)}
                      {c.lastUsedAt && ` · last used ${dateFmt.format(c.lastUsedAt)}`}
                    </span>
                  </div>
                  <DisconnectButton id={c.id} name={c.name} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Inspiration storage" aside={usage.blob ? "Vercel Blob" : "Database"} />
          <div className="px-4 py-4">
            <StorageMeter used={usage.used} limit={usage.limit} />
          </div>
        </Card>

        <Card>
          <CardHeader title="iPhone Shortcut" />
          <div className="flex flex-col gap-3 px-4 py-4">
            <CopyAddress address={`${proto}://${host}/api/inspiration/shortcut`} label="Copy Shortcut address" />
            <ShortcutKey hasKey={shortcutKey} />
          </div>
        </Card>

        <Card>
          <Link href="/trash" className="press-tint flex items-center gap-3 px-4 py-3.5 hover:bg-muted/50">
            <Trash2 className="size-[18px] text-muted-foreground" aria-hidden />
            <span className="flex grow flex-col gap-0.5">
              <span className="font-medium">Trash</span>
              <span className="text-xs text-muted-foreground">
                {inTrash === 0 ? "Empty" : `${inTrash} ${inTrash === 1 ? "item" : "items"}`}
              </span>
            </span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </Card>

        <Card>
          <CardHeader title="Account" />
          <div className="px-4 py-4">
            <SignOutButton />
          </div>
        </Card>
      </div>
    </Page>
  );
}
