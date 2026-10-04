import { notFound, redirect } from "next/navigation";
import { OperationError } from "@/core/define";
import { getCard } from "@/core/pipeline";

/** A card's own address (from search, notifications and the activity log): opens it on its project's Board. */
export default async function CardPage({ params }: PageProps<"/cards/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let projectId: string;
  try {
    projectId = (await getCard(id)).project.id;
  } catch (err) {
    if (err instanceof OperationError) notFound();
    throw err;
  }
  redirect(`/projects/${projectId}?view=board&by=pipeline&card=${id}`);
}
