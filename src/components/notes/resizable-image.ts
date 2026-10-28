import { Image } from "@tiptap/extension-image";
import type { NodeViewRendererProps } from "@tiptap/react";
import { MIN_WIDTH, joinImageSrc, splitImageSrc } from "@/lib/image-width";

const CORNERS = ["nw", "ne", "sw", "se"] as const;

/** The width of the text the photo sits in, without padding. */
function columnWidth(el: HTMLElement) {
  const parent = el.parentElement;
  if (!parent) return el.offsetWidth;
  const style = getComputedStyle(parent);
  return parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

/**
 * Photos in the editors, with a handle on each corner to drag them bigger or
 * smaller. The shape always stays the same; the size is saved as a share of the
 * text column, so it looks the same on a phone, a computer and in the PDF.
 */
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const pct = el.style.width.match(/^(\d+(?:\.\d+)?)%$/)?.[1] ?? el.getAttribute("data-width");
          return pct ? Math.round(Number(pct)) || null : null;
        },
        renderHTML: (attrs) => (attrs.width ? { "data-width": attrs.width, style: `width: ${attrs.width}%` } : {}),
      },
      height: { default: null, rendered: false },
    };
  },

  parseMarkdown: (token, helpers) => {
    const { src, width } = splitImageSrc(token.href ?? "");
    return helpers.createNode("image", { src, width, title: token.title, alt: token.text });
  },

  renderMarkdown: (node) => {
    const src = joinImageSrc(node.attrs?.src ?? "", node.attrs?.width);
    const alt = node.attrs?.alt ?? "";
    const title = node.attrs?.title ?? "";
    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
  },

  addNodeView() {
    return ({ node: initial, getPos, editor }: NodeViewRendererProps) => {
      let node = initial;
      const frame = document.createElement("div");
      frame.className = "img-frame";
      const img = document.createElement("img");
      img.draggable = false;
      frame.append(img);

      const show = () => {
        const { src, alt, title, width } = node.attrs;
        if (img.getAttribute("src") !== src) img.src = src ?? "";
        if (alt) img.alt = alt;
        else img.removeAttribute("alt");
        if (title) img.title = title;
        else img.removeAttribute("title");
        frame.style.width = width ? `${width}%` : "";
        frame.classList.toggle("is-sized", !!width);
      };
      show();

      for (const corner of CORNERS) {
        const handle = document.createElement("span");
        handle.className = "img-handle";
        handle.dataset.corner = corner;
        handle.addEventListener("dragstart", (e) => e.preventDefault());
        handle.addEventListener("pointerdown", (e) => {
          if (!editor.isEditable || e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          handle.setPointerCapture(e.pointerId);
          // Dragging a handle resizes; the photo itself shouldn't start moving.
          frame.draggable = false;
          frame.classList.add("is-resizing");
          const startX = e.clientX;
          const startWidth = img.getBoundingClientRect().width;
          const column = columnWidth(frame);
          const left = corner.endsWith("w");
          let pct = (startWidth / column) * 100;

          const move = (ev: PointerEvent) => {
            const dx = (ev.clientX - startX) * (left ? -1 : 1);
            const px = Math.min(column, Math.max((column * MIN_WIDTH) / 100, startWidth + dx));
            pct = (px / column) * 100;
            frame.style.width = `${pct}%`;
            frame.classList.add("is-sized");
          };
          const end = () => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", end);
            handle.removeEventListener("pointercancel", end);
            frame.classList.remove("is-resizing");
            frame.draggable = true;
            const pos = typeof getPos === "function" ? getPos() : undefined;
            const width = Math.round(pct);
            if (pos === undefined || width === node.attrs.width) return show();
            editor.view.dispatch(editor.view.state.tr.setNodeAttribute(pos, "width", width >= 100 ? 100 : width));
          };
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", end);
          handle.addEventListener("pointercancel", end);
        });
        frame.append(handle);
      }

      return {
        dom: frame,
        update: (next) => {
          if (next.type !== node.type) return false;
          node = next;
          show();
          return true;
        },
        // Clicks and drags on the handles belong to the resize, not the editor.
        stopEvent: (event) => (event.target as HTMLElement | null)?.classList?.contains("img-handle") ?? false,
        ignoreMutation: (m) => m.type !== "selection",
      };
    };
  },
});
