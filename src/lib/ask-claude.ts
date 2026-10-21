/**
 * Marks something the LukeOS Mac app can offer "Ask Claude about this" for
 * when it's right-clicked. Does nothing in a browser.
 */
export function askClaudeAbout(item: { kind: string; id: string; title: string }) {
  return { "data-ask-claude": JSON.stringify(item) };
}
