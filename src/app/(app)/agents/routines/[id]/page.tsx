import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { RoutineEditor } from "@/components/routines/routine-editor";
import { RunHistory } from "@/components/routines/run-history";
import { whenShort } from "@/components/routines/when";
import { OperationError } from "@/core/define";
import { getCheckIns, getRoutine, settleMissed } from "@/core/routines";
import { getTimeZone } from "@/core/settings";
import { listSops } from "@/core/sops";

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    return await getRoutine(id, 30);
  } catch (err) {
    if (err instanceof OperationError) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: PageProps<"/agents/routines/[id]">): Promise<Metadata> {
  const routine = await load((await params).id);
  return { title: `${routine.title || "Untitled routine"} · LukeOS` };
}

export default async function RoutinePage({ params, searchParams }: PageProps<"/agents/routines/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  await settleMissed();
  const [{ runs, ...routine }, sops, checkIns, timeZone] = await Promise.all([load(id), listSops(), getCheckIns(), getTimeZone()]);
  const back = { href: "/agents?view=routines", label: "Routines" };

  return (
    <div className="flex min-w-0 grow flex-col">
      <header className="hidden h-14 shrink-0 items-center gap-2 border-b px-6 md:flex">
        <Link href={back.href} className="inline-flex items-center text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
      </header>
      <div className="flex flex-col gap-2 px-5 pt-[max(env(safe-area-inset-top),1rem)] pb-28 md:px-10 md:pt-8 md:pb-10">
        <Link
          href={back.href}
          className="-ml-1 inline-flex items-center self-start pt-8 text-meta text-muted-foreground hover:text-foreground md:hidden"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
        <div className="flex max-w-3xl min-w-0 flex-col gap-6">
          <RoutineEditor
            key={routine.id}
            routine={routine}
            sops={sops.map((s) => ({ id: s.id, title: s.title }))}
            checkIns={checkIns}
            next={routine.nextDueAt ? whenShort(routine.nextDueAt, timeZone) : null}
            autoFocus={query.new === "1"}
          />
          <RunHistory runs={runs} timeZone={timeZone} />
        </div>
      </div>
    </div>
  );
}
