import { MENTION_PATH } from "@/lib/mentions";

/** Shows the @claude tags Claude has dealt with greyed out, with a tick. */
export function DoneTags({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  const tags = ids.map((id) => `.note-body a[href="${MENTION_PATH}${id}"]`);
  return (
    <style>{`${tags.join(",")}{color:var(--muted-foreground)}${tags
      .map((t) => `${t}::after`)
      .join(",")}{content:" ✓"}`}</style>
  );
}
