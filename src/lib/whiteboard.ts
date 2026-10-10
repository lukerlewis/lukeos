/**
 * Whiteboards: the shared model used by the screen and by Claude's tools.
 *
 * A board is a list of items, stored as one compact JSON tree. Claude reads
 * and writes that same tree, so there's nothing to translate. On screen each
 * item becomes an HTML element: a frame with auto layout is a CSS flexbox,
 * so padding, gap and direction behave exactly as they do in Figma.
 *
 * Only the fields that differ from the defaults are stored, which keeps a
 * board small for Claude to read.
 */

export type ItemType = "frame" | "text" | "sticky" | "shape" | "arrow";
export type TextStyle = "display" | "h1" | "h2" | "h3" | "h4" | "sub-lg" | "sub-sm" | "body-lg" | "body";
export type Color =
  | "default"
  | "muted"
  | "white"
  | "grey"
  | "yellow"
  | "orange"
  | "red"
  | "pink"
  | "purple"
  | "blue"
  | "green"
  | "none";
export type Layout = "row" | "column";
export type Align = "start" | "center" | "end";
export type ShapeKind = "rect" | "ellipse" | "diamond";

export type Item = {
  id: string;
  type: ItemType;
  /** Position. Inside a frame it's relative to the frame; ignored inside an auto layout frame. */
  x?: number;
  y?: number;
  /** Size. Text with no width grows to fit on one line; a frame with auto layout and no size hugs its contents. */
  w?: number;
  h?: number;
  /** Words on a text, sticky, shape or arrow. */
  text?: string;
  /** Text: one of the type scale styles. */
  style?: TextStyle;
  weight?: "regular" | "medium";
  /** Fill for frames, stickies and shapes; text colour for text. */
  color?: Color;
  /** Text: line alignment. Frame with auto layout: how children line up across the flow. */
  align?: Align;
  shape?: ShapeKind;
  /** Frames: a label shown above top-level frames. */
  name?: string;
  /** Frames: auto layout direction. Leave out for free placement. */
  layout?: Layout;
  gap?: number;
  padX?: number;
  padY?: number;
  /** Arrows: the ids of the items it joins. */
  from?: string;
  to?: string;
  /** Frames: what's inside, in order. */
  children?: Item[];
};

/** An item as written by hand or by Claude: everything but the type may be left out, ids included. */
export type RawItem = Partial<Omit<Item, "children">> & { type: ItemType; children?: RawItem[] };

/** Luke's type scale, from his Figma file. All Geist, regular weight. */
export const TEXT_STYLES: Record<TextStyle, { label: string; size: number; lineHeight: number; tracking: number }> = {
  display: { label: "Display", size: 111.8, lineHeight: 1, tracking: -0.04 },
  h1: { label: "Heading 1", size: 86, lineHeight: 1.05, tracking: -0.04 },
  h2: { label: "Heading 2", size: 66, lineHeight: 1.1, tracking: -0.04 },
  h3: { label: "Heading 3", size: 51, lineHeight: 1.15, tracking: -0.04 },
  h4: { label: "Heading 4", size: 39, lineHeight: 1.2, tracking: -0.04 },
  "sub-lg": { label: "Subheading large", size: 30, lineHeight: 1.3, tracking: -0.04 },
  "sub-sm": { label: "Subheading small", size: 23, lineHeight: 1.4, tracking: -0.04 },
  "body-lg": { label: "Body large", size: 18, lineHeight: 1.5, tracking: -0.02 },
  body: { label: "Body", size: 14, lineHeight: 1.5, tracking: 0 },
};
export const TEXT_STYLE_KEYS = Object.keys(TEXT_STYLES) as TextStyle[];

export const ITEM_TYPES: ItemType[] = ["frame", "text", "sticky", "shape", "arrow"];
export const COLORS: Color[] = ["default", "muted", "white", "grey", "yellow", "orange", "red", "pink", "purple", "blue", "green", "none"];
/** The fills offered for stickies, shapes and frames, in order. */
export const FILLS: Color[] = ["white", "grey", "yellow", "orange", "red", "pink", "purple", "blue", "green"];

/** What an item looks like when a field is left out. */
export const DEFAULTS = {
  text: { style: "body-lg" as TextStyle, weight: "regular" as const, color: "default" as Color, align: "start" as Align },
  sticky: { w: 220, h: 220, color: "yellow" as Color },
  shape: { w: 180, h: 120, color: "white" as Color, shape: "rect" as ShapeKind },
  frame: { w: 480, h: 320, color: "white" as Color, gap: 16, padX: 24, padY: 24, align: "start" as Align },
};

/** Short random ids, a few characters each, so Claude reads fewer tokens. */
export function newId(taken?: Set<string>) {
  for (;;) {
    const id = Math.random().toString(36).slice(2, 8);
    if (id.length === 6 && !taken?.has(id)) {
      taken?.add(id);
      return id;
    }
  }
}

export function walk(items: Item[], fn: (item: Item, parent: Item | null) => void, parent: Item | null = null) {
  for (const item of items) {
    fn(item, parent);
    if (item.children) walk(item.children, fn, item);
  }
}

export function allIds(items: Item[]) {
  const ids = new Set<string>();
  walk(items, (i) => ids.add(i.id));
  return ids;
}

export function countItems(items: Item[]) {
  let n = 0;
  walk(items, () => n++);
  return n;
}

/** Finds an item and where it sits. */
export function locate(items: Item[], id: string): { item: Item; parent: Item | null; index: number } | null {
  let found: { item: Item; parent: Item | null; index: number } | null = null;
  const search = (list: Item[], parent: Item | null) => {
    for (let i = 0; i < list.length && !found; i++) {
      if (list[i].id === id) found = { item: list[i], parent, index: i };
      else if (list[i].children) search(list[i].children!, list[i]);
    }
  };
  search(items, null);
  return found;
}

/** The ids of an item's frames, from the top of the board down to its parent. */
export function ancestorsOf(items: Item[], id: string): string[] {
  const path: string[] = [];
  const search = (list: Item[], trail: string[]): boolean => {
    for (const item of list) {
      if (item.id === id) {
        path.push(...trail);
        return true;
      }
      if (item.children && search(item.children, [...trail, item.id])) return true;
    }
    return false;
  };
  search(items, []);
  return path;
}

/** A copy of the board with one item changed (returns the same board if the id isn't there). */
export function mapItem(items: Item[], id: string, fn: (item: Item) => Item): Item[] {
  // Returns the same array when nothing in it changed, so untouched items keep their identity.
  const visit = (list: Item[]): Item[] => {
    let changed = false;
    const next = list.map((item) => {
      if (item.id === id) {
        changed = true;
        return fn(item);
      }
      if (!item.children) return item;
      const children = visit(item.children);
      if (children === item.children) return item;
      changed = true;
      return { ...item, children };
    });
    return changed ? next : list;
  };
  return visit(items);
}

/** A copy of the board without these items, or any arrows joined to them. */
export function removeItems(items: Item[], ids: Set<string>): Item[] {
  const gone = new Set(ids);
  // Taking a frame takes what's inside it.
  walk(items, (item) => {
    if (gone.has(item.id) && item.children) walk(item.children, (c) => gone.add(c.id));
  });
  const visit = (list: Item[]): Item[] =>
    list
      .filter((i) => !gone.has(i.id) && !(i.type === "arrow" && (gone.has(i.from ?? "") || gone.has(i.to ?? ""))))
      .map((i) => (i.children ? { ...i, children: visit(i.children) } : i));
  return visit(items);
}

/** Puts items into a frame (or the board, with a null parent) at a position. */
export function insertItems(items: Item[], parentId: string | null, index: number, add: Item[]): Item[] {
  if (parentId === null) {
    const next = [...items];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, ...add);
    return next;
  }
  return mapItem(items, parentId, (frame) => {
    const children = [...(frame.children ?? [])];
    children.splice(Math.max(0, Math.min(index, children.length)), 0, ...add);
    return { ...frame, children };
  });
}

/** A deep copy with new ids. Arrows inside the copy are rejoined to the copied items. */
export function cloneWithNewIds(add: Item[], taken: Set<string>): Item[] {
  const map = new Map<string, string>();
  walk(add, (i) => map.set(i.id, newId(taken)));
  const copy = (list: Item[]): Item[] =>
    list.map((i) => ({
      ...i,
      id: map.get(i.id)!,
      ...(i.type === "arrow" && { from: map.get(i.from ?? "") ?? i.from, to: map.get(i.to ?? "") ?? i.to }),
      ...(i.children && { children: copy(i.children) }),
    }));
  return copy(add);
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Tidies an item: keeps only the fields its type uses, rounds numbers, drops
 * defaults, and gives it (and its children) an id if it has none.
 */
export function cleanItem(raw: RawItem, taken: Set<string>): Item {
  const id = raw.id && !taken.has(raw.id) ? raw.id : newId(taken);
  taken.add(id);
  const out: Item = { id, type: raw.type };
  const num = (k: "x" | "y" | "w" | "h" | "gap" | "padX" | "padY", min = -Infinity) => {
    const v = raw[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.max(min, round(v));
  };
  if (raw.type !== "arrow") {
    num("x");
    num("y");
  }
  const t = raw.type;
  if (t === "frame" || t === "sticky" || t === "shape" || t === "text") num("w", 1);
  if (t === "frame" || t === "sticky" || t === "shape") num("h", 1);
  if (t !== "frame" && raw.text) out.text = raw.text;
  if (t === "text") {
    if (raw.style && raw.style !== DEFAULTS.text.style) out.style = raw.style;
    if (raw.weight === "medium") out.weight = "medium";
    if (raw.color && raw.color !== "default" && raw.color !== "none") out.color = raw.color;
    if (raw.align && raw.align !== "start") out.align = raw.align;
  }
  if (t === "sticky" && raw.color && raw.color !== DEFAULTS.sticky.color) out.color = raw.color;
  if (t === "shape") {
    if (raw.color && raw.color !== DEFAULTS.shape.color) out.color = raw.color;
    if (raw.shape && raw.shape !== "rect") out.shape = raw.shape;
  }
  if (t === "frame") {
    if (raw.name) out.name = raw.name;
    if (raw.color && raw.color !== DEFAULTS.frame.color) out.color = raw.color;
    if (raw.layout) {
      out.layout = raw.layout;
      num("gap", 0);
      num("padX", 0);
      num("padY", 0);
      if (raw.align && raw.align !== "start") out.align = raw.align;
    }
    out.children = (raw.children ?? []).map((c) => cleanItem(c, taken));
  }
  if (t === "arrow") {
    if (raw.from) out.from = raw.from;
    if (raw.to) out.to = raw.to;
  }
  return out;
}

/** Tidies a whole board, and drops arrows whose ends are missing. */
export function cleanBoard(items: RawItem[]): Item[] {
  const taken = new Set<string>();
  const cleaned = items.map((i) => cleanItem(i, taken));
  const ids = allIds(cleaned);
  const keep = (list: Item[]): Item[] =>
    list
      .filter((i) => i.type !== "arrow" || (i.from && i.to && ids.has(i.from) && ids.has(i.to) && i.from !== i.to))
      .map((i) => (i.children ? { ...i, children: keep(i.children) } : i));
  return keep(cleaned);
}

const KEY_ORDER = ["id", "type", "name", "text", "x", "y", "w", "h", "style", "weight", "shape", "color", "layout", "gap", "padX", "padY", "align", "from", "to", "children"];

/** The same items with their fields in a readable order (the database sorts them by length). */
export function orderKeys(items: Item[]): Item[] {
  return items.map((item) => {
    const out: Record<string, unknown> = {};
    for (const k of KEY_ORDER) if (k in item) out[k] = k === "children" ? orderKeys(item.children ?? []) : item[k as keyof Item];
    return out as Item;
  });
}

/** The board's rough outline in board coordinates, from top-level positions and sizes (no measuring). */
export function roughBounds(items: Item[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const i of items) {
    if (i.type === "arrow") continue;
    const x = i.x ?? 0,
      y = i.y ?? 0;
    const size = sizeGuess(i);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + size.w);
    maxY = Math.max(maxY, y + size.h);
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
}

/** A guess at an item's size without drawing it, for placing new things clear of old ones. */
export function sizeGuess(i: Item): { w: number; h: number } {
  if (i.type === "sticky") return { w: i.w ?? DEFAULTS.sticky.w, h: i.h ?? DEFAULTS.sticky.h };
  if (i.type === "shape") return { w: i.w ?? DEFAULTS.shape.w, h: i.h ?? DEFAULTS.shape.h };
  if (i.type === "text") {
    const s = TEXT_STYLES[i.style ?? DEFAULTS.text.style];
    const lines = (i.text ?? "").split("\n");
    const longest = Math.max(...lines.map((l) => l.length), 1);
    const w = i.w ?? longest * s.size * 0.5;
    const wrapped = i.w ? lines.reduce((n, l) => n + Math.max(1, Math.ceil((l.length * s.size * 0.5) / i.w!)), 0) : lines.length;
    return { w, h: wrapped * s.size * s.lineHeight };
  }
  if (i.type === "frame") {
    if (!i.layout) return { w: i.w ?? DEFAULTS.frame.w, h: i.h ?? DEFAULTS.frame.h };
    const kids = (i.children ?? []).filter((c) => c.type !== "arrow").map(sizeGuess);
    const gap = i.gap ?? DEFAULTS.frame.gap;
    const padX = i.padX ?? DEFAULTS.frame.padX;
    const padY = i.padY ?? DEFAULTS.frame.padY;
    const along = kids.reduce((n, k) => n + (i.layout === "row" ? k.w : k.h), 0) + gap * Math.max(0, kids.length - 1);
    const across = Math.max(0, ...kids.map((k) => (i.layout === "row" ? k.h : k.w)));
    const w = i.w ?? (i.layout === "row" ? along : across) + padX * 2;
    const h = i.h ?? (i.layout === "row" ? across : along) + padY * 2;
    return { w, h };
  }
  return { w: 0, h: 0 };
}
