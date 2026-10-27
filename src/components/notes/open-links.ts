import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { MENTION_PATH } from "@/lib/mentions";

/** Only web and mail links open; @claude tags and anything else stay put. */
function openable(href: string) {
  try {
    const url = new URL(href, window.location.href);
    if (url.pathname.startsWith(MENTION_PATH) && url.origin === window.location.origin) return null;
    return /^(https?|mailto):$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** A pasted web address ("https://…" or "www.…"), or null for anything else. */
function webAddress(text: string) {
  if (/\s/.test(text)) return null;
  const withProtocol = /^www\./i.test(text) ? `https://${text}` : text;
  if (!/^https?:\/\/[^/]+\.[^/]/i.test(withProtocol)) return null;
  try {
    return new URL(withProtocol).href;
  } catch {
    return null;
  }
}

/**
 * Links in the editors: a click opens the link in a new window (the Mac app
 * hands it to the default browser), and the caret still lands so the text can
 * be edited. Pasting a web address over selected text links that text.
 */
export const OpenLinks = Extension.create({
  name: "openLinks",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("openLinks"),
        props: {
          handleClick: (view, _pos, event) => {
            if (event.button !== 0) return false;
            const a = (event.target as HTMLElement | null)?.closest?.("a");
            if (!a || !view.dom.contains(a)) return false;
            const href = openable(a.getAttribute("href") ?? "");
            if (href) window.open(href, "_blank", "noopener,noreferrer");
            return false;
          },
          handlePaste: (view, event) => {
            if (view.state.selection.empty) return false;
            const text = event.clipboardData?.getData("text/plain").trim() ?? "";
            const href = webAddress(text);
            if (!href) return false;
            return editor.chain().focus().setLink({ href }).run();
          },
        },
      }),
    ];
  },
});
