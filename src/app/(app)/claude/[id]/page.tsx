import { redirect } from "next/navigation";

/** Where an @claude tag points: the list of @claude requests. */
export default async function ClaudeTagPage({ params }: PageProps<"/claude/[id]">) {
  const { id } = await params;
  redirect(`/agents?view=claude#${encodeURIComponent(id)}`);
}
