"use client";

import { memo } from "react";
import { DEFAULTS, TEXT_STYLES, type Color, type Item } from "@/lib/whiteboard";

/**
 * Draws whiteboard items as plain HTML. Used by the editor and by the small
 * previews on the boards list, so a board looks the same everywhere.
 * A frame with auto layout is a flexbox; without it, its children are placed
 * by x and y. Strokes are outlines, so they never change the layout.
 */

export const fillOf = (c: Color | undefined) => (!c || c === "none" ? "transparent" : c === "default" || c === "muted" ? "var(--wb-white)" : `var(--wb-${c})`);

export const textColorOf = (c: Color | undefined) =>
  !c || c === "default" || c === "none"
    ? "var(--ink)"
    : c === "muted"
      ? "var(--muted-foreground)"
      : c === "white"
        ? "var(--grey-0)"
        : c === "grey"
          ? "var(--grey-700)"
          : `var(--wb-text-${c})`;

const ALIGN = { start: "flex-start", center: "center", end: "flex-end" } as const;
const TEXT_ALIGN = { start: "left", center: "center", end: "right" } as const;

const STICKY_TEXT = TEXT_STYLES["body-lg"];

export type ViewProps = {
  item: Item;
  /** Its parent lays it out (auto layout), so it has no position of its own. */
  inLayout?: boolean;
  topLevel?: boolean;
  /** Moved by this much while being dragged. */
  offset?: { dx: number; dy: number } | null;
  /** Items being dragged, so children can find their offsets. */
  dragging?: Set<string> | null;
  dragOffset?: { dx: number; dy: number } | null;
  /** The item whose words are being typed, if any. */
  editingId?: string | null;
  /** Called with the new words when typing ends. */
  onEdited?: (id: string, text: string) => void;
  /** Set on previews, which show no frame names. */
  preview?: boolean;
};

export const ItemView = memo(function ItemView(props: ViewProps) {
  const { item, inLayout, topLevel, offset } = props;
  if (item.type === "arrow") return null;
  const position: React.CSSProperties = inLayout
    ? { position: "relative", flexShrink: 0 }
    : { position: "absolute", left: item.x ?? 0, top: item.y ?? 0 };
  const moved: React.CSSProperties = offset
    ? { transform: `translate(${offset.dx}px, ${offset.dy}px)`, zIndex: 10, pointerEvents: "none" }
    : {};
  const editing = props.editingId === item.id;

  if (item.type === "frame") {
    const fill = item.color ?? DEFAULTS.frame.color;
    const layout = item.layout;
    const hug = !!layout;
    const style: React.CSSProperties = {
      ...position,
      width: item.w ?? (hug ? undefined : DEFAULTS.frame.w),
      height: item.h ?? (hug ? undefined : DEFAULTS.frame.h),
      background: fillOf(fill),
      outline: fill === "white" ? "1px solid var(--stroke)" : undefined,
      outlineOffset: -1,
      borderRadius: 16,
      ...(layout && {
        display: "flex",
        flexDirection: layout,
        gap: item.gap ?? DEFAULTS.frame.gap,
        padding: `${item.padY ?? DEFAULTS.frame.padY}px ${item.padX ?? DEFAULTS.frame.padX}px`,
        alignItems: ALIGN[item.align ?? "start"],
      }),
      ...(hug && !item.w && { width: "max-content" }),
      ...moved,
    };
    return (
      <div data-wb-id={item.id} data-wb-type="frame" data-wb-layout={layout ?? undefined} style={style}>
        {topLevel && item.name && !props.preview && (
          <div
            className="pointer-events-none absolute left-0 truncate text-muted-foreground select-none"
            style={{ bottom: "100%", maxWidth: "100%", fontSize: "calc(13px / var(--wb-z, 1))", paddingBottom: "calc(6px / var(--wb-z, 1))" }}
          >
            {item.name}
          </div>
        )}
        {(item.children ?? []).map((child) => (
          <ItemView
            key={child.id}
            item={child}
            inLayout={!!layout}
            offset={props.dragging?.has(child.id) ? props.dragOffset : null}
            dragging={props.dragging}
            dragOffset={props.dragOffset}
            editingId={props.editingId}
            onEdited={props.onEdited}
            preview={props.preview}
          />
        ))}
      </div>
    );
  }

  if (item.type === "text") {
    const s = TEXT_STYLES[item.style ?? DEFAULTS.text.style];
    const style: React.CSSProperties = {
      ...position,
      width: item.w ?? "max-content",
      minWidth: 4,
      fontSize: s.size,
      lineHeight: s.lineHeight,
      letterSpacing: `${s.tracking}em`,
      fontWeight: item.weight === "medium" ? 500 : 400,
      color: textColorOf(item.color),
      textAlign: TEXT_ALIGN[item.align ?? "start"],
      whiteSpace: item.w ? "pre-wrap" : "pre",
      overflowWrap: "break-word",
      ...moved,
    };
    return (
      <div data-wb-id={item.id} data-wb-type="text" style={style}>
        <Words item={item} editing={editing} onEdited={props.onEdited} placeholder="Text" />
      </div>
    );
  }

  if (item.type === "sticky") {
    const fill = item.color ?? DEFAULTS.sticky.color;
    const style: React.CSSProperties = {
      ...position,
      width: item.w ?? DEFAULTS.sticky.w,
      minHeight: item.h ?? DEFAULTS.sticky.h,
      padding: 20,
      background: fillOf(fill),
      outline: fill === "white" ? "1px solid var(--stroke)" : undefined,
      outlineOffset: -1,
      borderRadius: 6,
      color: "var(--ink)",
      fontSize: STICKY_TEXT.size,
      lineHeight: STICKY_TEXT.lineHeight,
      letterSpacing: `${STICKY_TEXT.tracking}em`,
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      ...moved,
    };
    return (
      <div data-wb-id={item.id} data-wb-type="sticky" style={style}>
        <Words item={item} editing={editing} onEdited={props.onEdited} />
      </div>
    );
  }

  // Shapes
  const fill = item.color ?? DEFAULTS.shape.color;
  const kind = item.shape ?? "rect";
  const w = item.w ?? DEFAULTS.shape.w;
  const h = item.h ?? DEFAULTS.shape.h;
  const stroke = fill === "white" ? "var(--stroke-strong)" : "transparent";
  const style: React.CSSProperties = {
    ...position,
    width: w,
    height: h,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: kind === "diamond" ? `${h / 4}px ${w / 4}px` : 16,
    textAlign: "center",
    color: "var(--ink)",
    fontSize: STICKY_TEXT.size,
    lineHeight: STICKY_TEXT.lineHeight,
    letterSpacing: `${STICKY_TEXT.tracking}em`,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    ...(kind !== "diamond" && {
      background: fillOf(fill),
      outline: `1px solid ${stroke}`,
      outlineOffset: -1,
      borderRadius: kind === "ellipse" ? "50%" : 12,
    }),
    ...moved,
  };
  return (
    <div data-wb-id={item.id} data-wb-type="shape" style={style}>
      {kind === "diamond" && (
        <svg className="pointer-events-none absolute inset-0 overflow-visible" width={w} height={h} aria-hidden>
          <polygon
            points={`${w / 2},0.5 ${w - 0.5},${h / 2} ${w / 2},${h - 0.5} 0.5,${h / 2}`}
            fill={fillOf(fill)}
            stroke={stroke}
            strokeLinejoin="round"
          />
        </svg>
      )}
      <span className="relative max-w-full">
        <Words item={item} editing={editing} onEdited={props.onEdited} />
      </span>
    </div>
  );
});

/** The words on an item, or a box to type them in. */
function Words({
  item,
  editing,
  onEdited,
  placeholder,
}: {
  item: Item;
  editing: boolean;
  onEdited?: (id: string, text: string) => void;
  placeholder?: string;
}) {
  if (!editing) {
    if (!item.text && placeholder) return <span className="text-disabled">{placeholder}</span>;
    return <>{item.text ?? ""}</>;
  }
  return (
    <span
      data-wb-editor
      ref={(el) => {
        if (!el || el.dataset.ready) return;
        el.dataset.ready = "1";
        el.innerText = item.text ?? "";
        el.focus();
        // Put the cursor at the end.
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      className="block min-w-[1ch] outline-none"
      style={{ cursor: "text" }}
      onBlur={(e) => onEdited?.(item.id, e.currentTarget.innerText.replace(/\n$/, ""))}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
