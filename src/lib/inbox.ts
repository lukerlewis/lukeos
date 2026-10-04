/**
 * A pipeline column called "Inbox" holds ideas suggested to Luke (usually by
 * Claude). Its cards get Approve (move on to the next column) and Reject (hide
 * it, but keep it so Claude won't suggest it again).
 */
export function isInbox(column: { name: string } | null | undefined) {
  return column?.name.trim().toLowerCase() === "inbox";
}
