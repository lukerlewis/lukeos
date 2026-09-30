import { Extension, InputRule } from "@tiptap/react";
import { MENTION_PATH } from "@/lib/mentions";

/**
 * Typing "@claude" then a space or punctuation turns it into a tag: a small
 * link with its own id, so it stays the same @claude request however the
 * words around it change.
 */
export const ClaudeTag = Extension.create({
  name: "claudeTag",
  addInputRules() {
    return [
      new InputRule({
        find: /(?:^|[\s(])@claude([\s.,!?;:)])$/i,
        handler: ({ state, range }) => {
          const link = state.schema.marks.link;
          if (!link) return null;
          // The space or punctuation just typed is already in place; find "@claude" before it.
          const before = state.doc.textBetween(range.from, range.to, "\n", "\n");
          const at = before.toLowerCase().lastIndexOf("@claude");
          if (at < 0) return null;
          const start = range.from + at;
          const end = start + "@claude".length;
          // Already a tag: leave it alone.
          if (state.doc.rangeHasMark(start, end, link)) return null;
          const tr = state.tr;
          tr.replaceWith(start, end, state.schema.text("@claude", [link.create({ href: `${MENTION_PATH}${crypto.randomUUID()}` })]));
          tr.removeStoredMark(link);
        },
      }),
    ];
  },
});
