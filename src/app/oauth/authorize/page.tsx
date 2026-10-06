import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { checkAuthorizeRequest } from "@/lib/auth/oauth";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Connect Claude · LukeOS" };

/** The screen Claude sends Luke to when he adds the LukeOS connector. */
export default async function AuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  const raw = await searchParams;
  const params = new URLSearchParams(
    Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])),
  );
  if (!(await getSession())) redirect(`/sign-in?next=${encodeURIComponent(`/oauth/authorize?${params}`)}`);

  const check = await checkAuthorizeRequest(params);

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-16">
      <div className="flex w-full max-w-sm flex-col items-center gap-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Sparkles className="size-6" aria-hidden />
        </span>
        {check.ok ? (
          <>
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-medium">Connect {check.client.name} to LukeOS?</h1>
              <p className="text-control text-muted-foreground">
                Claude will be able to see and change your projects and tasks, just as you can. Anything it adds is
                labelled as made by Claude.
              </p>
              <p className="text-meta text-muted-foreground">
                You can disconnect it at any time in Settings.
              </p>
            </div>
            <form method="post" action="/api/oauth/authorize" className="flex w-full flex-col gap-2">
              {[...params.entries()].map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <Button type="submit" name="decision" value="allow" size="lg" className="w-full">
                Allow
              </Button>
              <Button type="submit" name="decision" value="deny" variant="ghost" size="lg" className="w-full">
                Cancel
              </Button>
            </form>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-medium">Couldn&apos;t connect</h1>
            <p className="text-control text-muted-foreground">{check.error}</p>
          </div>
        )}
      </div>
    </main>
  );
}
