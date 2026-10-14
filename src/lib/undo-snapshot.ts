/**
 * Which reads tell us how something looked before a change, so Undo can put it back.
 * The server does these reads just before the change, in the same request, so a save is one trip.
 */
export function snapshotReads(name: string, input: Record<string, unknown>): { name: string; input: { id: string } }[] | null {
  const ids = (key: string) => ((input[key] as string[] | undefined) ?? []);
  switch (name) {
    case "update_task":
    case "move_task":
      return [{ name: "get_task", input: { id: input.id as string } }];
    case "update_tasks":
    case "move_tasks":
      return ids("ids").map((id) => ({ name: "get_task", input: { id } }));
    case "update_notes":
      return ids("ids").map((id) => ({ name: "get_note", input: { id } }));
    case "update_artifact":
      return [{ name: "get_artifact", input: { id: input.id as string } }];
    case "update_artifacts":
      return ids("ids").map((id) => ({ name: "get_artifact", input: { id } }));
    case "update_project":
      return [{ name: "get_project", input: { id: input.id as string } }];
    default:
      return null;
  }
}
