/**
 * "@claude" in Luke's text. In a note it's saved as a small link,
 * [@claude](/claude/<id>), so each tag keeps its identity while the words
 * around it change. In plain text (tasks, comments) it's just "@claude".
 */

export const MENTION_PATH = "/claude/";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const linked = new RegExp(`\\[@claude\\]\\(${MENTION_PATH}(${uuid})\\)`, "gi");
// "@claude" on its own: not part of an email address, a word, or a link's text.
const bare = /(^|[^\w[/@.])@claude\b(?!\])/gi;

export const mentionLink = (id: string) => `[@claude](${MENTION_PATH}${id})`;

/** A line of text made readable: links reduced to their words, Markdown symbols dropped. */
function readable(line: string) {
  return line
    .replace(linked, "@claude")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(#{1,6}|[-*+]\s+\[[ xX]\]|[-*+]|\d+\.|>)\s*/, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

export type FoundMention = { id: string | null; context: string };

/** Every @claude in a piece of text, with the line it's on. Tagged ones carry their id. */
export function findMentions(text: string | null | undefined): FoundMention[] {
  if (!text || !/@claude/i.test(text)) return [];
  const found: FoundMention[] = [];
  for (const line of text.split(/\n/)) {
    if (!/@claude/i.test(line)) continue;
    const context = readable(line);
    for (const m of line.matchAll(linked)) found.push({ id: m[1].toLowerCase(), context });
    // Untagged ones on the same line are one request.
    if (bare.test(line.replace(linked, ""))) found.push({ id: null, context });
    bare.lastIndex = 0;
  }
  return found;
}

/** Turns each untagged "@claude" in Markdown into a tag with its own id. */
export function tagMentions(markdown: string, newId: () => string) {
  return markdown
    .split(/\n/)
    .map((line) => {
      const parts = line.split(linked);
      // split() with a capture group interleaves text and ids; only the text parts get tagged.
      return parts
        .map((part, i) => (i % 2 === 1 ? mentionLink(part) : part.replace(bare, (_, before: string) => `${before}${mentionLink(newId())}`)))
        .join("");
    })
    .join("\n");
}
