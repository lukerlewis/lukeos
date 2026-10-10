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
export type Side = "top" | "right" | "bottom" | "left";
export const SIDES: Side[] = ["top", "right", "bottom", "left"];

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
  /** Arrows: the side of the joined item an end is pinned to. Left out, it picks the side facing the other end. */
  fromSide?: Side;
  toSide?: Side;
  /** Arrows: where an end that isn't joined to anything sits, in board coordinates. */
  start?: [number, number];
  end?: [number, number];
  /** Arrows: "none" draws a plain line with no arrowhead. */
  head?: "none";
  /** Arrows: an elbow arrow runs in straight horizontal and vertical lines instead of one diagonal. */
  elbow?: boolean;
  /** Elbow arrows: the corners Luke set by dragging, in board coordinates. Left out, the route is worked out. */
  bends?: [number, number][];
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
      ...(i.type === "arrow" && i.from && { from: map.get(i.from) ?? i.from }),
      ...(i.type === "arrow" && i.to && { to: map.get(i.to) ?? i.to }),
      ...(i.children && { children: copy(i.children) }),
    }));
  return copy(add);
}

/**
 * The arrows that should be copied along with these items: those joined to them at both ends,
 * or at one end with the other left on the board. Arrows already among the items aren't repeated.
 */
export function arrowsAmong(board: Item[], picked: Item[]): Item[] {
  const inside = allIds(picked);
  const out: Item[] = [];
  walk(board, (i) => {
    if (i.type !== "arrow" || inside.has(i.id)) return;
    const ends = [i.from, i.to].filter((e): e is string => !!e);
    if (ends.length && ends.every((e) => inside.has(e))) out.push(i);
  });
  return out;
}

/** An arrow moved along with what it joins: its bends and any ends left on the board shift too. */
export function shiftArrow(a: Item, dx: number, dy: number): Item {
  const by = ([x, y]: [number, number]) => [Math.round(x + dx), Math.round(y + dy)] as [number, number];
  return {
    ...a,
    ...(a.bends && { bends: a.bends.map(by) }),
    ...(a.start && { start: by(a.start) }),
    ...(a.end && { end: by(a.end) }),
  };
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
    const point = (p: unknown) =>
      Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n)) ? ([round(p[0]), round(p[1])] as [number, number]) : null;
    const side = (v: unknown) => (SIDES.includes(v as Side) ? (v as Side) : null);
    if (raw.from) {
      out.from = raw.from;
      if (side(raw.fromSide)) out.fromSide = side(raw.fromSide)!;
    } else if (point(raw.start)) out.start = point(raw.start)!;
    if (raw.to) {
      out.to = raw.to;
      if (side(raw.toSide)) out.toSide = side(raw.toSide)!;
    } else if (point(raw.end)) out.end = point(raw.end)!;
    if (raw.head === "none") out.head = "none";
    if (raw.elbow) {
      out.elbow = true;
      const bends = (raw.bends ?? [])
        .filter((b) => Array.isArray(b) && b.length === 2 && b.every((n) => typeof n === "number" && Number.isFinite(n)))
        .slice(0, 50)
        .map(([x, y]) => [round(x), round(y)] as [number, number]);
      if (bends.length) out.bends = bends;
    }
  }
  return out;
}

/** Whether each end of an arrow is joined to an item that exists or sits at a point, and it doesn't join an item to itself. */
export function arrowEndsOk(a: RawItem, ids: Set<string>): boolean {
  const from = a.from ? ids.has(a.from) : !!a.start;
  const to = a.to ? ids.has(a.to) : !!a.end;
  return from && to && !(a.from && a.from === a.to);
}

/** Tidies a whole board, and drops arrows whose ends are missing. */
export function cleanBoard(items: RawItem[]): Item[] {
  const taken = new Set<string>();
  const cleaned = items.map((i) => cleanItem(i, taken));
  const ids = allIds(cleaned);
  const keep = (list: Item[]): Item[] =>
    list
      .filter((i) => i.type !== "arrow" || arrowEndsOk(i, ids))
      .map((i) => (i.children ? { ...i, children: keep(i.children) } : i));
  return keep(cleaned);
}

const KEY_ORDER = ["id", "type", "name", "text", "x", "y", "w", "h", "style", "weight", "shape", "color", "layout", "gap", "padX", "padY", "align", "from", "fromSide", "start", "to", "toSide", "end", "head", "elbow", "bends", "children"];

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

// ---- Arrow routes ----

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

/** How far an arrow stays off the edge of what it joins: a little more at the head end. */
const START_GAP = 6;
const END_GAP = 8;

/** Where a straight arrow between two boxes starts and ends: on each box's edge, along the line between their centres. */
export function straightRoute(a: Box, b: Box, gaps: [number, number] = [START_GAP, END_GAP]): Point[] {
  return [edgeToward(a, centre(b), gaps[0]), edgeToward(b, centre(a), gaps[1])];
}

const centre = (r: Box): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** The point on a box's edge on the line from its centre towards a point, a gap outside it. */
function edgeToward(r: Box, to: Point, gap: number): Point {
  const from = centre(r);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (!dx && !dy) return from;
  const tx = dx ? r.w / 2 / Math.abs(dx) : Infinity;
  const ty = dy ? r.h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  const len = Math.hypot(dx, dy);
  return { x: from.x + dx * t + (dx / len) * gap, y: from.y + dy * t + (dy / len) * gap };
}

/** The middle of one side of a box. */
export function sidePoint(r: Box, side: Side, gap = 0): Point {
  if (side === "top") return { x: r.x + r.w / 2, y: r.y - gap };
  if (side === "bottom") return { x: r.x + r.w / 2, y: r.y + r.h + gap };
  if (side === "left") return { x: r.x - gap, y: r.y + r.h / 2 };
  return { x: r.x + r.w + gap, y: r.y + r.h / 2 };
}

/** How far an elbow arrow runs straight out of a pinned side before it turns. */
const STUB = 20;

/** The corners an elbow arrow takes when nobody has moved them: across, down and across (or the other way round). */
function autoBends(a: Box, b: Box): Point[] {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const gapX = cb.x > ca.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
  const gapY = cb.y > ca.y ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
  if (gapX > 0 && gapX >= gapY) {
    const midX = cb.x > ca.x ? a.x + a.w + gapX / 2 : b.x + b.w + gapX / 2;
    // Side by side with some overlap: one straight line through the middle of it.
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    if (bottom - top > 0) return [{ x: midX, y: (top + bottom) / 2 }];
    return [
      { x: midX, y: ca.y },
      { x: midX, y: cb.y },
    ];
  }
  if (gapY > 0) {
    const midY = cb.y > ca.y ? a.y + a.h + gapY / 2 : b.y + b.h + gapY / 2;
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + a.w, b.x + b.w);
    if (right - left > 0) return [{ x: (left + right) / 2, y: midY }];
    return [
      { x: ca.x, y: midY },
      { x: cb.x, y: midY },
    ];
  }
  // Overlapping boxes: one corner.
  return [{ x: cb.x, y: ca.y }];
}

/** The way out of a box towards a point, in straight lines: the point on its edge, and a corner if one is needed. */
function leave(r: Box, p: Point, gap: number): Point[] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const inX = p.x > r.x && p.x < r.x + r.w;
  const inY = p.y > r.y && p.y < r.y + r.h;
  if (inY && !inX) return [{ x: p.x > cx ? r.x + r.w + gap : r.x - gap, y: p.y }];
  if (inX && !inY) return [{ x: p.x, y: p.y > cy ? r.y + r.h + gap : r.y - gap }];
  if (inX && inY) return [];
  // Off a corner: go out of the side that faces it most, then turn.
  if (Math.abs(p.x - cx) - r.w / 2 >= Math.abs(p.y - cy) - r.h / 2)
    return [
      { x: p.x > cx ? r.x + r.w + gap : r.x - gap, y: cy },
      { x: p.x, y: cy },
    ];
  return [
    { x: cx, y: p.y > cy ? r.y + r.h + gap : r.y - gap },
    { x: cx, y: p.y },
  ];
}

/** Drops repeated points and corners that don't turn. */
export function tidyRoute(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      const straight = (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5);
      if (!straight) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

/**
 * An elbow arrow's path, from its start on one box to its end on the other,
 * in horizontal and vertical lines only, through its bends if it has any.
 */
export function elbowRoute(a: Box, b: Box, bends?: [number, number][], gaps: [number, number] = [START_GAP, END_GAP]): Point[] {
  const corners = bends?.length ? bends.map(([x, y]) => ({ x, y })) : autoBends(a, b);
  const raw = [...leave(a, corners[0], gaps[0]), ...corners, ...leave(b, corners[corners.length - 1], gaps[1]).reverse()];
  // Anything that isn't level or upright gets a corner.
  const square: Point[] = [];
  for (const p of raw) {
    const last = square[square.length - 1];
    if (last && Math.abs(last.x - p.x) >= 0.5 && Math.abs(last.y - p.y) >= 0.5) square.push({ x: p.x, y: last.y });
    square.push(p);
  }
  const route = tidyRoute(square);
  if (route.length >= 2) return route;
  return straightRoute(a, b, gaps);
}

/**
 * An arrow's path between its two ends. Each end is the box of the item it's joined to,
 * or a point (a box with no size) where it's left on the board.
 */
export function arrowRoute(a: Item, from: Box, to: Box): Point[] {
  const gaps: [number, number] = [a.from ? START_GAP : 0, a.to ? (a.head === "none" ? START_GAP : END_GAP) : 0];
  const fromSide = a.from ? a.fromSide : undefined;
  const toSide = a.to ? a.toSide : undefined;
  if (!fromSide && !toSide) return a.elbow ? elbowRoute(from, to, a.bends, gaps) : straightRoute(from, to, gaps);
  // A pinned end sits in the middle of its side.
  const pa = fromSide && sidePoint(from, fromSide, gaps[0]);
  const pb = toSide && sidePoint(to, toSide, gaps[1]);
  if (!a.elbow) return [pa || edgeToward(from, pb || centre(to), gaps[0]), pb || edgeToward(to, pa || centre(from), gaps[1])];
  // Elbow: run straight out of a pinned side for a moment, then route from there.
  const out = (p: Point, side: Side): Box => {
    const s = sidePoint({ x: p.x, y: p.y, w: 0, h: 0 }, side, STUB);
    return { x: s.x, y: s.y, w: 0, h: 0 };
  };
  const ra = pa ? out(pa, fromSide!) : from;
  const rb = pb ? out(pb, toSide!) : to;
  const middle = elbowRoute(ra, rb, a.bends, [pa ? 0 : gaps[0], pb ? 0 : gaps[1]]);
  const all = [...(pa ? [pa] : []), ...middle, ...(pb ? [pb] : [])];
  // Anything that isn't level or upright gets a corner.
  const square: Point[] = [];
  for (const p of all) {
    const last = square[square.length - 1];
    if (last && Math.abs(last.x - p.x) >= 0.5 && Math.abs(last.y - p.y) >= 0.5) square.push({ x: p.x, y: last.y });
    square.push(p);
  }
  return tidyRoute(square);
}

/** An arrow's path through its points, with the corners slightly rounded. */
export function routeToPath(points: Point[], radius = 6): string {
  if (!points.length) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1];
    const c = points[i];
    const n = points[i + 1];
    const r = Math.min(radius, Math.hypot(c.x - p.x, c.y - p.y) / 2, Math.hypot(n.x - c.x, n.y - c.y) / 2);
    const towards = (from: Point, to: Point, dist: number) => {
      const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      return { x: from.x + ((to.x - from.x) / len) * dist, y: from.y + ((to.y - from.y) / len) * dist };
    };
    const a = towards(c, p, r);
    const b = towards(c, n, r);
    d += ` L ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/** The point halfway along a path, for its label. */
export function routeMiddle(points: Point[]): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let left = lengths.reduce((n, l) => n + l, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i]) {
      const t = lengths[i] ? left / lengths[i] : 0;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
    }
    left -= lengths[i];
  }
  return points[0];
}

/** The two short strokes of an arrowhead at the end of a path, pointing along its last line. */
export function arrowHead(points: Point[], length = 11, spread = 7): string {
  const tip = points[points.length - 1];
  const from = points[points.length - 2] ?? tip;
  const len = Math.hypot(tip.x - from.x, tip.y - from.y);
  if (!len) return "";
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  const bx = tip.x - ux * length;
  const by = tip.y - uy * length;
  return `M ${bx - uy * spread} ${by + ux * spread} L ${tip.x} ${tip.y} L ${bx + uy * spread} ${by - ux * spread}`;
}
