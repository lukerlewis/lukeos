import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { SopEditor } from "@/components/sops/sop-editor";
import { OperationError } from "@/core/define";
import { getContext } from "@/core/context";

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    return await getContext(id);
  } catch (err) {
    if (err instanceof OperationError) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: PageProps<"/agents/context/[id]">): Promise<Metadata> {
  const file = await load((await params).id);
  return { title: `${file.title || "Untitled"} · LukeOS` };
}

export default async function ContextPage({ params, searchParams }: PageProps<"/agents/context/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const file = await load(id);
  const back = { href: "/agents?view=context", label: "Context" };

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
          className="-ml-1 inline-flex items-center self-start pt-8 text-[13px] text-muted-foreground hover:text-foreground md:hidden"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
        <div className="max-w-3xl min-w-0">
          <SopEditor key={file.id} sop={file} kind="context" autoFocus={query.new === "1"} />
        </div>
      </div>
    </div>
  );
}
