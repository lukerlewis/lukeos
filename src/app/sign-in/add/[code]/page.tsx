import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isValidInvite } from "@/lib/auth/device-invite";
import { getSession } from "@/lib/auth/session";
import { AddThisDevice } from "./add-this-device";

export const metadata: Metadata = { title: "Add this device · LukeOS" };

/** Opened on a new device from the one-time link made in Settings. */
export default async function AddDevicePage({ params }: PageProps<"/sign-in/add/[code]">) {
  if (await getSession()) redirect("/settings");
  const { code } = await params;
  const valid = await isValidInvite(code);

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-16">
      <div className="flex w-full max-w-sm flex-col items-center gap-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary text-2xl font-semibold text-primary-foreground">
          L
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{valid ? "Add this device" : "Link expired"}</h1>
          <p className="text-control text-muted-foreground">
            {valid ? "Create a passkey here to sign in." : "Make a new one in Settings on a signed-in device."}
          </p>
        </div>
        {valid ? (
          <AddThisDevice code={code} />
        ) : (
          <Link href="/sign-in" className="text-control font-medium text-primary">
            Back to sign in
          </Link>
        )}
      </div>
    </main>
  );
}
