import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import {
  allIds,
  cleanBoard,
  cleanItem,
  COLORS,
  countItems,
  insertItems,
  ITEM_TYPES,
  locate,
  orderKeys,
  mapItem,
  removeItems,
  roughBounds,
  sizeGuess,
  TEXT_STYLE_KEYS,
  walk,
  type Item,
  type RawItem,
} from "@/lib/whiteboard";
import { defineOperation, madeByColumns, madeByOf, OperationError } from "./define";

const { whiteboards } = schema;
const live = isNull(whiteboards.deletedAt);

/** Big enough for a busy board, small enough that a runaway write can't fill the database. */
const MAX_BYTES = 1_000_000;

export type WhiteboardSummary = {
  id: string;
  title: string;
  itemCount: number;
  madeBy: ReturnType<typeof madeByOf>;
  createdAt: Date;
  updatedAt: Date;
};

export type Whiteboard = { id: string; title: string; version: number; items: Item[]; madeBy: ReturnType<typeof madeByOf>; updatedAt: Date };

export async function listWhiteboards(): Promise<WhiteboardSummary[]> {
  const rows = await db.select().from(whiteboards).where(live).orderBy(desc(whiteboards.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    itemCount: countItems(r.items),
    madeBy: madeByOf(r),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/** Every board with its items, for the previews on the Whiteboard screen. */
export async function listWhiteboardsWithItems() {
  const rows = await db.select().from(whiteboards).where(live).orderBy(desc(whiteboards.updatedAt));
  return rows.map((r) => ({ id: r.id, title: r.title, items: r.items, madeBy: madeByOf(r), updatedAt: r.updatedAt }));
}

export async function getWhiteboard(id: string): Promise<Whiteboard> {
  const [row] = await db
    .select()
    .from(whiteboards)
    .where(and(eq(whiteboards.id, id), live))
    .limit(1);
  if (!row) throw new OperationError("That whiteboard doesn't exist, or it's in Trash.", 404);
  return { id: row.id, title: row.title, version: row.version, items: orderKeys(row.items), madeBy: madeByOf(row), updatedAt: row.updatedAt };
}

/** Reads the board, lets `change` work on its items, and saves the result as the next version. */
async function changeBoard<T>(id: string, change: (items: Item[]) => { items: Item[]; result?: T }) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ items: whiteboards.items, version: whiteboards.version })
      .from(whiteboards)
      .where(and(eq(whiteboards.id, id), live))
      .for("update");
    if (!row) throw new OperationError("That whiteboard doesn't exist, or it's in Trash.", 404);
    const { items, result } = change(row.items);
    checkSize(items);
    const version = row.version + 1;
    await tx.update(whiteboards).set({ items, version, updatedAt: new Date() }).where(eq(whiteboards.id, id));
    return { version, result };
  });
}

function checkSize(items: Item[]) {
  if (JSON.stringify(items).length > MAX_BYTES) throw new OperationError("That's too much for one whiteboard. Start another board.");
}

const num = z.number().finite();
/** One item as Claude writes it. Everything but the type is optional. */
const itemInput: z.ZodType<RawItem> = z.object({
  id: z.string().max(40).optional().describe("Leave out for new items; one is made for you."),
  type: z.enum(ITEM_TYPES),
  x: num.optional(),
  y: num.optional(),
  w: num.positive().optional(),
  h: num.positive().optional(),
  text: z.string().max(20_000).optional(),
  style: z.enum(TEXT_STYLE_KEYS).optional(),
  weight: z.enum(["regular", "medium"]).optional(),
  color: z.enum(COLORS).optional(),
  align: z.enum(["start", "center", "end"]).optional(),
  shape: z.enum(["rect", "ellipse", "diamond"]).optional(),
  name: z.string().max(200).optional(),
  layout: z.enum(["row", "column"]).optional(),
  gap: num.min(0).optional(),
  padX: num.min(0).optional(),
  padY: num.min(0).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  elbow: z.boolean().optional(),
  bends: z.array(z.tuple([num, num])).max(50).optional(),
  get children() {
    return z.array(itemInput).optional();
  },
});

const FORMAT = `Items: {id, type, ...}. Types: frame (a container: name, color fill, w/h, children; with layout "row" or "column" it's Figma-style auto layout using gap, padX, padY and align start|center|end, and hugs its contents unless w/h are set), text (text, style, weight regular|medium, color default|muted, align start|center|end, w to wrap), sticky (text, color, w/h; default 220x220 yellow), shape (shape rect|ellipse|diamond, text, color, w/h), arrow (from and to: item ids, text for a label; elbow: true runs it in horizontal and vertical lines with slightly rounded corners, routed for you, or through bends: [[x,y],...] corners in board pixels to steer it around things). Text styles (Luke's type scale, Geist): display 112px, h1 86, h2 66, h3 51, h4 39, sub-lg 30, sub-sm 23, body-lg 18 (default), body 14. Fills: white, grey, yellow, orange, red, pink, purple, blue, green, none. x/y are board pixels (inside a frame, relative to it; ignored in auto layout). Left-out fields use the defaults, so leave them out. Keep diagrams black and white (white, grey, none): add colour only when it means something the layout and words don't already show (Luke's SOP "Diagrams and visualizations").`;

const boardId = z.uuid().describe("The whiteboard's id, from list_whiteboards.");

/** Places top-level items that came without a position below everything already there, side by side. */
function placeNew(existing: Item[], add: Item[]) {
  const bounds = roughBounds(existing);
  let x = bounds?.x ?? 0;
  const y = bounds ? bounds.y + bounds.h + 80 : 0;
  return add.map((item) => {
    if (item.type === "arrow" || (item.x !== undefined && item.y !== undefined)) return item;
    const placed = { ...item, x: item.x ?? x, y: item.y ?? y };
    x += sizeGuess(item).w + 40;
    return placed;
  });
}

const changeInput = z.object({
  id: z.string().describe("The item's id."),
  x: num.nullable().optional(),
  y: num.nullable().optional(),
  w: num.positive().nullable().optional().describe("null makes text grow to fit, or an auto layout frame hug."),
  h: num.positive().nullable().optional(),
  text: z.string().max(20_000).nullable().optional(),
  style: z.enum(TEXT_STYLE_KEYS).nullable().optional(),
  weight: z.enum(["regular", "medium"]).nullable().optional(),
  color: z.enum(COLORS).nullable().optional(),
  align: z.enum(["start", "center", "end"]).nullable().optional(),
  shape: z.enum(["rect", "ellipse", "diamond"]).nullable().optional(),
  name: z.string().max(200).nullable().optional(),
  layout: z.enum(["row", "column"]).nullable().optional().describe("null turns auto layout off."),
  gap: num.min(0).nullable().optional(),
  padX: num.min(0).nullable().optional(),
  padY: num.min(0).nullable().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  elbow: z.boolean().nullable().optional(),
  bends: z.array(z.tuple([num, num])).max(50).nullable().optional().describe("null resets an elbow arrow to its worked-out route."),
  parent: z.string().nullable().optional().describe("Move it into this frame (its id), or null for the board itself."),
  index: z.number().int().min(0).optional().describe("Where among its siblings, 0 first. With parent, or alone to reorder."),
});

export const whiteboardOperations = {
  list_whiteboards: defineOperation({
    name: "list_whiteboards",
    description: "Luke's whiteboards (FigJam-style boards), most recently changed first: id, title and how many items each has.",
    input: z.object({}),
    run: async () =>
      (await listWhiteboards()).map((b) => ({ id: b.id, title: b.title, items: b.itemCount, updatedAt: b.updatedAt, madeBy: b.madeBy.kind })),
  }),

  get_whiteboard: defineOperation({
    name: "get_whiteboard",
    description: `Read a whiteboard: its title, version and every item as a compact JSON tree. ${FORMAT}`,
    input: z.object({
      id: boardId,
      ifNewerThan: z.number().int().optional().describe("Only return the items if the board's version is higher than this."),
    }),
    run: async ({ id, ifNewerThan }) => {
      const board = await getWhiteboard(id);
      if (ifNewerThan !== undefined && board.version <= ifNewerThan) return { id, version: board.version, unchanged: true as const };
      return { id: board.id, title: board.title, version: board.version, items: board.items };
    },
  }),

  create_whiteboard: defineOperation({
    name: "create_whiteboard",
    description: `Make a new whiteboard, optionally with items on it. ${FORMAT}`,
    input: z.object({
      title: z.string().trim().max(200).optional(),
      items: z.array(itemInput).max(2000).optional(),
    }),
    run: async ({ title, items }, { actor }) => {
      const cleaned = cleanBoard(items ?? []);
      checkSize(cleaned);
      const [row] = await db
        .insert(whiteboards)
        .values({ title: title ?? "", items: placeNew([], cleaned), ...madeByColumns(actor) })
        .returning({ id: whiteboards.id });
      const board = await getWhiteboard(row.id);
      return { id: board.id, title: board.title, version: board.version, items: board.items };
    },
  }),

  update_whiteboard: defineOperation({
    name: "update_whiteboard",
    description: "Rename a whiteboard.",
    input: z.object({ id: boardId, title: z.string().trim().max(200) }),
    run: async ({ id, title }) => {
      await getWhiteboard(id);
      await db.update(whiteboards).set({ title, updatedAt: new Date() }).where(eq(whiteboards.id, id));
      return { id, title };
    },
  }),

  delete_whiteboard: defineOperation({
    name: "delete_whiteboard",
    description: "Move a whiteboard to Trash, where it's kept for 30 days. Only when Luke asks.",
    input: z.object({ id: boardId }),
    run: async ({ id }) => {
      await getWhiteboard(id);
      await db.update(whiteboards).set({ deletedAt: new Date() }).where(eq(whiteboards.id, id));
      return { deleted: id };
    },
  }),

  add_whiteboard_items: defineOperation({
    name: "add_whiteboard_items",
    description: `Add items to a whiteboard (frames can hold children). Top-level items without x/y are placed below what's there. Returns the new ids. ${FORMAT}`,
    input: z.object({
      id: boardId,
      items: z.array(itemInput).min(1).max(2000),
      parent: z.string().optional().describe("Put them inside this frame (its id) instead of on the board."),
      index: z.number().int().min(0).optional().describe("Where among the parent's children; the end if left out."),
    }),
    run: async ({ id, items, parent, index }) => {
      const out = await changeBoard(id, (current) => {
        const taken = allIds(current);
        let add = items.map((i) => cleanItem(i, taken));
        if (parent) {
          const p = locate(current, parent);
          if (!p || p.item.type !== "frame") throw new OperationError(`There's no frame with id "${parent}" on this board.`);
        } else add = placeNew(current, add);
        const siblings = parent ? (locate(current, parent)!.item.children ?? []) : current;
        const next = insertItems(current, parent ?? null, index ?? siblings.length, add);
        const ids = allIds(next);
        const bad = add.filter((a) => a.type === "arrow" && !(a.from && a.to && ids.has(a.from) && ids.has(a.to)));
        if (bad.length) throw new OperationError("An arrow needs from and to set to ids of items on the board.");
        const added: string[] = [];
        walk(add, (i) => added.push(i.id));
        return { items: next, result: added };
      });
      return { version: out.version, added: out.result };
    },
  }),

  update_whiteboard_items: defineOperation({
    name: "update_whiteboard_items",
    description:
      "Change items on a whiteboard: any field (null clears it back to the default), or move one with parent/index. Fields left out stay as they are. Use add_whiteboard_items for new children.",
    input: z.object({ id: boardId, changes: z.array(changeInput).min(1).max(2000) }),
    run: async ({ id, changes }) => {
      const out = await changeBoard(id, (current) => {
        let items = current;
        for (const change of changes) {
          const found = locate(items, change.id);
          if (!found) throw new OperationError(`There's no item with id "${change.id}" on this board.`);
          const { parent, index, ...fields } = change;
          const merged: Record<string, unknown> = { ...found.item };
          for (const [k, v] of Object.entries(fields)) {
            if (k === "id" || v === undefined) continue;
            if (v === null) delete merged[k];
            else merged[k] = v;
          }
          delete merged.children;
          const taken = allIds(items);
          taken.delete(found.item.id);
          const cleaned = cleanItem(merged as RawItem, taken);
          items = mapItem(items, found.item.id, () => ({ ...cleaned, ...(found.item.children && { children: found.item.children }) }));
          if (parent !== undefined || index !== undefined) {
            const target = parent === undefined ? (found.parent?.id ?? null) : parent;
            if (target !== null) {
              const t = locate(items, target);
              if (!t || t.item.type !== "frame") throw new OperationError(`There's no frame with id "${target}" on this board.`);
              if (target === found.item.id || allIds(found.item.children ?? []).has(target))
                throw new OperationError("A frame can't go inside itself.");
            }
            const item = locate(items, found.item.id)!.item;
            items = removeItemOnly(items, item.id);
            const siblings = target === null ? items : (locate(items, target)!.item.children ?? []);
            items = insertItems(items, target, index ?? siblings.length, [item]);
          }
        }
        return { items };
      });
      return { version: out.version };
    },
  }),

  delete_whiteboard_items: defineOperation({
    name: "delete_whiteboard_items",
    description: "Remove items from a whiteboard. A frame takes its children with it, and arrows joined to removed items go too.",
    input: z.object({ id: boardId, ids: z.array(z.string()).min(1).max(2000) }),
    run: async ({ id, ids }) => {
      const out = await changeBoard(id, (current) => ({ items: removeItems(current, new Set(ids)) }));
      return { version: out.version };
    },
  }),

  set_whiteboard_items: defineOperation({
    name: "set_whiteboard_items",
    description: `Replace everything on a whiteboard with these items (the app saves this way). For small changes prefer add/update/delete_whiteboard_items. ${FORMAT}`,
    input: z.object({
      id: boardId,
      items: z.array(itemInput).max(5000),
      baseVersion: z
        .number()
        .int()
        .optional()
        .describe("The version these items were based on. If the board has changed since, nothing is saved and the current board is returned."),
    }),
    run: async ({ id, items, baseVersion }) => {
      const cleaned = cleanBoard(items);
      checkSize(cleaned);
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select({ version: whiteboards.version, items: whiteboards.items })
          .from(whiteboards)
          .where(and(eq(whiteboards.id, id), live))
          .for("update");
        if (!row) throw new OperationError("That whiteboard doesn't exist, or it's in Trash.", 404);
        if (baseVersion !== undefined && baseVersion !== row.version)
          return { saved: false as const, version: row.version, items: orderKeys(row.items) };
        const version = row.version + 1;
        await tx.update(whiteboards).set({ items: cleaned, version, updatedAt: new Date() }).where(eq(whiteboards.id, id));
        return { saved: true as const, version };
      });
    },
  }),
};

/** Takes one item out of the tree without touching arrows (it's being moved, not deleted). */
function removeItemOnly(items: Item[], id: string): Item[] {
  const visit = (list: Item[]): Item[] =>
    list.filter((i) => i.id !== id).map((i) => (i.children ? { ...i, children: visit(i.children) } : i));
  return visit(items);
}
