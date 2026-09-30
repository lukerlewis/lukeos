import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isSetUp } from "@/lib/auth/passkeys";
import { getSession } from "@/lib/auth/session";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in · LukeOS" };

export default async function SignInPage() {
  if (await getSession()) redirect("/");
  const setUp = await isSetUp();

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-16">
      <div className="flex w-full max-w-sm flex-col items-center gap-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary text-2xl font-semibold text-primary-foreground">
          L
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{setUp ? "Welcome back" : "Set up LukeOS"}</h1>
          <p className="text-[15px] text-muted-foreground">
            {setUp
              ? "Sign in with Face ID, Touch ID or Windows Hello."
              : "Create a passkey on this device. From then on, only you can get in."}
          </p>
        </div>
        <SignInForm mode={setUp ? "sign-in" : "set-up"} />
      </div>
    </main>
  );
}
