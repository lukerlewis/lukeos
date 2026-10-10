"use client";

import {
  ChevronLeft,
  CornerDownRight,
  Diamond,
  Frame,
  Hand,
  Maximize,
  Minus,
  MousePointer2,
  MoveRight,
  Plus,
  Redo2,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { showToast, showTrashedToast } from "@/components/shell/toast";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import {
  allIds,
  ancestorsOf,
  cloneWithNewIds,
  DEFAULTS,
  insertItems,
  locate,
  mapItem,
  newId,
  removeItems,
  arrowHead,
  arrowRoute,
  arrowsAmong,
  shiftArrow,
  routeMiddle,
  routeToPath,
  tidyRoute,
  walk,
  type Item,
  type ItemType,
  type Point,
} from "@/lib/whiteboard";
import { ItemView } from "./item-view";
import { Panel } from "./panel";

type Rect = { x: number; y: number; w: number; h: number };
type Camera = { x: number; y: number; z: number };
type Tool = "select" | "hand" | "frame" | "text" | "sticky" | "shape" | "arrow";
type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type Gesture =
  | { kind: "pan"; sx: number; sy: number; cam: Camera }
  | { kind: "pinch"; dist: number; mid: { x: number; y: number }; cam: Camera }
  | { kind: "press"; ids: string[]; primary: string; sx: number; sy: number; alt: boolean; world: { x: number; y: number }; rect: Rect }
  | { kind: "drag"; ids: string[]; all: Set<string>; primary: string; grab: { x: number; y: number }; base: Rect | null }
  | { kind: "marquee"; x0: number; y0: number; additive: boolean; before: string[] }
  | { kind: "resize"; id: string; handle: Handle; start: Rect; inLayout: boolean; text: boolean }
  | { kind: "create"; tool: "frame" | "shape" | "text" | "sticky"; x0: number; y0: number; parent: string | null }
  | { kind: "arrow"; from: string | null; start: Point; sx: number; sy: number }
  | { kind: "end"; id: string; which: "from" | "to" }
  | { kind: "slide"; id: string; start: Point; orig: Item }
  | { kind: "bend"; id: string; work: Point[]; seg: number; level: boolean; start: Point };

const MIN_Z = 0.1;
const MAX_Z = 4;
const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

/** Copied items, shared between boards in this tab. */
let clipboard: Item[] = [];
const setClipboard = (items: Item[]) => {
  clipboard = items;
};

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
};

/** Undo and redo for the board, kept in this tab. */
function useHistory(initial: Item[]) {
  const [items, setItems] = useState(initial);
  const itemsRef = useRef(initial);
  const past = useRef<Item[][]>([]);
  const future = useRef<Item[][]>([]);
  const held = useRef<Item[] | null>(null);
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });
  const bump = useCallback(() => setCounts({ undo: past.current.length, redo: future.current.length }), []);

  const set = useCallback((next: Item[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);
  /** A finished change: remembered for undo. */
  const commit = useCallback(
    (next: Item[]) => {
      if (next === itemsRef.current) return;
      past.current.push(held.current ?? itemsRef.current);
      if (past.current.length > 200) past.current.shift();
      future.current = [];
      held.current = null;
      set(next);
      bump();
    },
    [set, bump],
  );
  /** Start of a change made in many small steps (resizing): only the start is remembered. */
  const begin = useCallback(() => {
    held.current = itemsRef.current;
  }, []);
  const live = useCallback((next: Item[]) => set(next), [set]);
  const end = useCallback(() => {
    if (held.current && held.current !== itemsRef.current) {
      past.current.push(held.current);
      future.current = [];
      bump();
    }
    held.current = null;
  }, [bump]);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return false;
    future.current.push(itemsRef.current);
    set(prev);
    bump();
    return true;
  }, [set, bump]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return false;
    past.current.push(itemsRef.current);
    set(next);
    bump();
    return true;
  }, [set, bump]);
  /** Someone else (Claude) changed the board: show theirs, without making it an undo step. */
  const replace = useCallback(
    (next: Item[]) => {
      past.current = [];
      future.current = [];
      set(next);
      bump();
    },
    [set, bump],
  );
  return useMemo(
    () => ({ items, itemsRef, commit, begin, live, end, undo, redo, replace, canUndo: counts.undo > 0, canRedo: counts.redo > 0 }),
    [items, commit, begin, live, end, undo, redo, replace, counts],
  );
}

export function WhiteboardEditor({ board }: { board: { id: string; title: string; version: number; items: Item[] } }) {
  const router = useRouter();
  const history = useHistory(board.items);
  const { items, itemsRef, commit, replace } = history;
  const [title, setTitle] = useState(board.title);
  const [cam, setCamState] = useState<Camera>({ x: 0, y: 0, z: 1 });
  const camRef = useRef(cam);
  const setCam = useCallback((c: Camera) => {
    camRef.current = c;
    setCamState(c);
  }, []);
  const [tool, setTool] = useState<Tool>("select");
  const [shapeKind, setShapeKind] = useState<"rect" | "ellipse" | "diamond">("rect");
  const [arrowKind, setArrowKind] = useState<"straight" | "elbow">("straight");
  /** Whether new arrows get a head: the last choice made in the panel. */
  const [lineOnly, setLineOnly] = useState(false);
  const [selection, setSelectionState] = useState<string[]>([]);
  const selectionRef = useRef<string[]>([]);
  const setSelection = useCallback((ids: string[]) => {
    selectionRef.current = ids;
    setSelectionState(ids);
  }, []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rects, setRects] = useState<Map<string, Rect>>(new Map());
  const rectsRef = useRef(rects);
  const [drag, setDrag] = useState<{ ids: Set<string>; dx: number; dy: number } | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [arrowDraft, setArrowDraft] = useState<{ from: string | null; start: Point; x: number; y: number } | null>(null);
  const [dropLine, setDropLine] = useState<Rect | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  const viewRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>());

  // ---- Coordinates ----
  const toWorld = useCallback((cx: number, cy: number) => {
    const r = viewRef.current!.getBoundingClientRect();
    const c = camRef.current;
    return { x: (cx - r.left - c.x) / c.z, y: (cy - r.top - c.y) / c.z };
  }, []);
  const toScreen = (r: Rect): Rect => ({ x: r.x * cam.z + cam.x, y: r.y * cam.z + cam.y, w: r.w * cam.z, h: r.h * cam.z });

  // Every item's place on the board, read from the page after each draw. It only
  // sets state when something actually moved, so it settles after one pass.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const view = viewRef.current;
    const world = worldRef.current;
    if (!view || !world) return;
    const vr = view.getBoundingClientRect();
    const c = camRef.current;
    const next = new Map<string, Rect>();
    world.querySelectorAll<HTMLElement>("[data-wb-id]").forEach((el) => {
      const r = el.getBoundingClientRect();
      next.set(el.dataset.wbId!, { x: (r.left - vr.left - c.x) / c.z, y: (r.top - vr.top - c.y) / c.z, w: r.width / c.z, h: r.height / c.z });
    });
    const prev = rectsRef.current;
    let same = prev.size === next.size;
    if (same)
      for (const [id, r] of next) {
        const p = prev.get(id);
        if (!p || Math.abs(p.x - r.x) > 0.01 || Math.abs(p.y - r.y) > 0.01 || Math.abs(p.w - r.w) > 0.01 || Math.abs(p.h - r.h) > 0.01) {
          same = false;
          break;
        }
      }
    if (!same) {
      rectsRef.current = next;
      setRects(next);
    }
  });

  // ---- Camera: remembered per board, or fitted to what's there ----
  const fitted = useRef(false);
  const fit = useCallback(
    (only?: string[]) => {
      const view = viewRef.current;
      if (!view) return;
      const list = [...rectsRef.current.entries()].filter(([id]) => (only ? only.includes(id) : !ancestorsOf(itemsRef.current, id).length));
      if (!list.length) {
        setCam({ x: view.clientWidth / 2, y: view.clientHeight / 2, z: 1 });
        return;
      }
      const minX = Math.min(...list.map(([, r]) => r.x));
      const minY = Math.min(...list.map(([, r]) => r.y));
      const maxX = Math.max(...list.map(([, r]) => r.x + r.w));
      const maxY = Math.max(...list.map(([, r]) => r.y + r.h));
      const pad = 80;
      const z = clampZ(Math.min(1, (view.clientWidth - pad * 2) / (maxX - minX || 1), (view.clientHeight - pad * 2) / (maxY - minY || 1)));
      setCam({ x: view.clientWidth / 2 - ((minX + maxX) / 2) * z, y: view.clientHeight / 2 - ((minY + maxY) / 2) * z, z });
    },
    [itemsRef, setCam],
  );
  useEffect(() => {
    if (fitted.current || !viewRef.current) return;
    fitted.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(`wb-cam-${board.id}`) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after mount
      if (saved && typeof saved.z === "number") return setCam(saved);
    } catch {}
    fit();
  }, [board.id, fit, setCam, rects]);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(`wb-cam-${board.id}`, JSON.stringify(cam));
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [cam, board.id]);

  // ---- Saving, and showing Claude's changes as they happen ----
  const version = useRef(board.version);
  const saved = useRef(board.items);
  const saving = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const save = useCallback(async () => {
    if (saving.current) return;
    const toSave = itemsRef.current;
    if (toSave === saved.current) return;
    saving.current = true;
    try {
      const res = await op("set_whiteboard_items", { id: board.id, items: toSave, baseVersion: version.current });
      version.current = res.version;
      if (res.saved) saved.current = toSave;
      else {
        // Claude changed the board while Luke was editing: show the board as it is now.
        saved.current = res.items;
        replace(res.items);
        showToast("Claude changed this board, so it was reloaded");
      }
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      saving.current = false;
      if (itemsRef.current !== saved.current) saveTimer.current = setTimeout(save, 400);
    }
  }, [board.id, replace, itemsRef]);
  useEffect(() => {
    if (items === saved.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 600);
  }, [items, save]);
  useEffect(() => {
    const flush = () => {
      if (itemsRef.current !== saved.current) void save();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [save, itemsRef]);
  useEffect(() => {
    const poll = async () => {
      if (document.hidden || saving.current || gesture.current || itemsRef.current !== saved.current) return;
      try {
        const res = await op("get_whiteboard", { id: board.id, ifNewerThan: version.current });
        if ("unchanged" in res || gesture.current || itemsRef.current !== saved.current || res.version <= version.current) return;
        version.current = res.version;
        saved.current = res.items;
        replace(res.items);
        const ids = allIds(res.items);
        setSelection(selectionRef.current.filter((id) => ids.has(id)));
      } catch {}
    };
    const t = setInterval(poll, 3000);
    window.addEventListener("focus", poll);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", poll);
    };
  }, [board.id, replace, itemsRef, setSelection]);

  // ---- Picking what was clicked ----
  /** The ids under a pointer, from the outermost frame in. */
  const chainAt = (target: EventTarget | null): string[] => {
    const chain: string[] = [];
    let el = (target as Element | null)?.closest?.("[data-wb-id]") as HTMLElement | null;
    while (el && worldRef.current?.contains(el)) {
      chain.unshift(el.dataset.wbId!);
      el = el.parentElement?.closest("[data-wb-id]") as HTMLElement | null;
    }
    return chain;
  };
  /** The innermost item under a point on screen, for joining an arrow to it. */
  const itemUnder = (cx: number, cy: number) => {
    const el = document.elementsFromPoint(cx, cy).find((n) => worldRef.current?.contains(n) && n.closest("[data-wb-id]"));
    const chain = el ? chainAt(el) : [];
    return chain.length ? chain[chain.length - 1] : null;
  };
  /** Like Figma: a click picks the top-level item, or a sibling of what's selected; Cmd picks the deepest. */
  const pick = (chain: string[], deep: boolean) => {
    if (!chain.length) return null;
    if (deep) return chain[chain.length - 1];
    const context = new Set<string | null>([null]);
    // Clicking inside a selected frame picks its child, as in Figma.
    for (const id of selectionRef.current) {
      context.add(id);
      for (const a of ancestorsOf(itemsRef.current, id)) context.add(a);
    }
    let chosen = chain[0];
    for (let i = 1; i < chain.length; i++) if (context.has(chain[i - 1])) chosen = chain[i];
    return chosen;
  };
  /** The deepest frame under a point that isn't being moved. */
  const frameAt = (cx: number, cy: number, skip: Set<string>) => {
    for (const el of document.elementsFromPoint(cx, cy)) {
      if (!(el instanceof HTMLElement) || !worldRef.current?.contains(el)) continue;
      const frame = el.closest<HTMLElement>("[data-wb-type='frame']");
      if (!frame) continue;
      let blocked = false;
      for (let e: HTMLElement | null = frame; e && e !== worldRef.current; e = e.parentElement)
        if (e.dataset.wbId && skip.has(e.dataset.wbId)) blocked = true;
      if (!blocked) return frame.dataset.wbId!;
    }
    return null;
  };

  /** Where dropped items would land: a frame (and their place in its auto layout), or the board. */
  const dropTargetAt = (cx: number, cy: number, skip: Set<string>) => {
    const parent = frameAt(cx, cy, skip);
    if (!parent) return { parent: null as string | null, index: 0, line: null as Rect | null };
    const frame = locate(itemsRef.current, parent)!.item;
    if (!frame.layout) return { parent, index: 0, line: null };
    const p = toWorld(cx, cy);
    const row = frame.layout === "row";
    const kids = (frame.children ?? []).filter((c) => !skip.has(c.id) && rectsRef.current.has(c.id));
    let index = 0;
    for (const k of kids) {
      const r = rectsRef.current.get(k.id)!;
      if ((row ? p.x : p.y) > (row ? r.x + r.w / 2 : r.y + r.h / 2)) index++;
    }
    const fr = rectsRef.current.get(parent)!;
    const before = kids[index - 1] && rectsRef.current.get(kids[index - 1].id);
    const after = kids[index] && rectsRef.current.get(kids[index].id);
    const gap = frame.gap ?? DEFAULTS.frame.gap;
    let line: Rect;
    if (row) {
      const x = after ? after.x - gap / 2 : before ? before.x + before.w + gap / 2 : fr.x + fr.w / 2;
      line = { x, y: fr.y + 4, w: 0, h: fr.h - 8 };
    } else {
      const y = after ? after.y - gap / 2 : before ? before.y + before.h + gap / 2 : fr.y + fr.h / 2;
      line = { x: fr.x + 4, y, w: fr.w - 8, h: 0 };
    }
    return { parent, index, line };
  };

  // ---- Changes ----
  const removeOnly = (list: Item[], ids: Set<string>): Item[] =>
    list.filter((i) => !ids.has(i.id)).map((i) => (i.children ? { ...i, children: removeOnly(i.children, ids) } : i));

  /** Adds a new item where Luke clicked: inside a frame if he clicked one. */
  const addAt = (item: Item, parent: string | null, world: { x: number; y: number }) => {
    let next = itemsRef.current;
    if (parent) {
      const frame = locate(next, parent)!.item;
      const fr = rectsRef.current.get(parent);
      if (frame.layout) next = insertItems(next, parent, frame.children?.length ?? 0, [omit(item, ["x", "y"])]); else next = insertItems(next, parent, frame.children?.length ?? 0, [{ ...item, x: Math.round(world.x - (fr?.x ?? 0)), y: Math.round(world.y - (fr?.y ?? 0)) }]);
    } else next = insertItems(next, null, next.length, [{ ...item, x: Math.round(world.x), y: Math.round(world.y) }]);
    commit(next);
    setSelection([item.id]);
  };

  const deleteSelection = () => {
    if (!selectionRef.current.length) return;
    commit(removeItems(itemsRef.current, new Set(selectionRef.current)));
    setSelection([]);
  };

  /** Selected items that aren't inside another selected item. */
  const topSelected = (ids = selectionRef.current) => {
    const set = new Set(ids);
    return ids.filter((id) => !ancestorsOf(itemsRef.current, id).some((a) => set.has(a)));
  };

  const duplicate = (ids: string[], shift = 24) => {
    let next = itemsRef.current;
    const taken = allIds(next);
    const made: string[] = [];
    const picked = topSelected(ids).map((id) => locate(next, id)!.item);
    const extra = arrowsAmong(next, picked);
    const copies = cloneWithNewIds([...picked, ...extra], taken);
    picked.forEach((item, n) => {
      const at = locate(next, item.id)!;
      const copy = copies[n];
      const moved = at.parent?.layout ? copy : copy.type === "arrow" ? shiftArrow(copy, shift, shift) : { ...copy, x: (copy.x ?? 0) + shift, y: (copy.y ?? 0) + shift };
      next = insertItems(next, at.parent?.id ?? null, at.index + 1, [moved]);
      made.push(copy.id);
    });
    // Arrows between the copies come along, joined to the copies.
    const arrows = copies.slice(picked.length).map((a) => shiftArrow(a, shift, shift));
    next = insertItems(next, null, next.length, arrows);
    commit(next);
    setSelection([...made, ...arrows.map((a) => a.id)]);
  };

  /** Shift+A: wrap the selection in an auto layout frame, or turn auto layout on for a selected frame. */
  const addAutoLayout = () => {
    const ids = topSelected();
    if (!ids.length) return;
    const first = locate(itemsRef.current, ids[0]);
    if (!first) return;
    if (ids.length === 1 && first.item.type === "frame") {
      if (!first.item.layout) setLayout(first.item.id, "column");
      return;
    }
    const parentId = first.parent?.id ?? null;
    if (ids.some((id) => (locate(itemsRef.current, id)?.parent?.id ?? null) !== parentId)) return;
    const rs = ids.map((id) => rectsRef.current.get(id)).filter(Boolean) as Rect[];
    if (rs.length !== ids.length) return;
    const minX = Math.min(...rs.map((r) => r.x));
    const minY = Math.min(...rs.map((r) => r.y));
    const spanX = Math.max(...rs.map((r) => r.x + r.w)) - minX;
    const spanY = Math.max(...rs.map((r) => r.y + r.h)) - minY;
    const row = spanX > spanY;
    const inLayout = !!first.parent?.layout;
    const ordered = inLayout
      ? ids.slice().sort((a, b) => locate(itemsRef.current, a)!.index - locate(itemsRef.current, b)!.index)
      : ids.slice().sort((a, b) => (row ? rectsRef.current.get(a)!.x - rectsRef.current.get(b)!.x : rectsRef.current.get(a)!.y - rectsRef.current.get(b)!.y));
    const children = ordered.map((id) => omit(locate(itemsRef.current, id)!.item, ["x", "y"]));
    const parentRect = parentId ? rectsRef.current.get(parentId) : null;
    const frame: Item = {
      id: newId(allIds(itemsRef.current)),
      type: "frame",
      color: "none",
      layout: row ? "row" : "column",
      gap: 16,
      padX: 0,
      padY: 0,
      children,
      ...(!inLayout && { x: Math.round(minX - (parentRect?.x ?? 0)), y: Math.round(minY - (parentRect?.y ?? 0)) }),
    };
    const index = Math.min(...ids.map((id) => locate(itemsRef.current, id)!.index));
    let next = removeOnly(itemsRef.current, new Set(ids));
    next = insertItems(next, parentId, index, [frame]);
    commit(next);
    setSelection([frame.id]);
  };

  /** Turns auto layout on or off without anything jumping. */
  const setLayout = (id: string, layout: "row" | "column" | null) => {
    const at = locate(itemsRef.current, id);
    if (!at) return;
    const fr = rectsRef.current.get(id);
    if (layout) {
      commit(
        mapItem(itemsRef.current, id, (f) => {
          const order = (f.children ?? []).slice().sort((a, b) => {
            const ra = rectsRef.current.get(a.id), rb = rectsRef.current.get(b.id);
            if (!ra || !rb) return 0;
            return layout === "row" ? ra.x - rb.x : ra.y - rb.y;
          });
          const children = f.layout ? f.children : order.map((c) => omit(c, ["x", "y"]));
          const rest = omit(f, ["w", "h"]);
          return { ...rest, layout, children, ...(f.layout && f.w && { w: f.w }), ...(f.layout && f.h && { h: f.h }) };
        }),
      );
    } else {
      commit(
        mapItem(itemsRef.current, id, (f) => {
          const rest = omit(f, ["layout", "gap", "padX", "padY", "align"]);
          return {
            ...rest,
            w: Math.round(fr?.w ?? f.w ?? DEFAULTS.frame.w),
            h: Math.round(fr?.h ?? f.h ?? DEFAULTS.frame.h),
            children: (f.children ?? []).map((c) => {
              const r = rectsRef.current.get(c.id);
              return r && fr ? { ...c, x: Math.round(r.x - fr.x), y: Math.round(r.y - fr.y) } : c;
            }),
          };
        }),
      );
    }
  };

  const update = (id: string, patch: Partial<Item>) =>
    commit(
      mapItem(itemsRef.current, id, (item) => {
        const next: Item = { ...item };
        for (const [k, v] of Object.entries(patch) as [keyof Item, unknown][]) {
          if (v === undefined) delete next[k];
          else (next as Record<string, unknown>)[k] = v;
        }
        return next;
      }),
    );

  const onEdited = useCallback(
    (id: string, text: string) => {
      setEditingId(null);
      const at = locate(itemsRef.current, id);
      if (!at) return;
      if (at.item.type === "text" && !text.trim()) {
        commit(removeItems(itemsRef.current, new Set([id])));
        setSelection([]);
        return;
      }
      if ((at.item.text ?? "") === text) return;
      commit(mapItem(itemsRef.current, id, (i) => (text ? { ...i, text } : omit(i, ["text"]))));
    },
    [commit, itemsRef, setSelection],
  );

  // ---- Pointer ----
  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("[data-wb-ui]")) return;
    if ((e.target as HTMLElement).closest("[data-wb-editor]")) return;
    if (editingId) (document.activeElement as HTMLElement | null)?.blur?.();
    viewRef.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

    // Two fingers: pinch to zoom, and pan.
    const touches = [...pointers.current.values()].filter((p) => p.type === "touch");
    if (touches.length === 2) {
      cancelGesture();
      const [a, b] = touches;
      gesture.current = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam: camRef.current };
      return;
    }
    if (pointers.current.size > 1) return;

    const world = toWorld(e.clientX, e.clientY);
    if (tool === "hand" || spaceDown || e.button === 1) {
      gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, cam: camRef.current };
      return;
    }
    const end = (e.target as HTMLElement).closest<HTMLElement>("[data-wb-end]")?.dataset.wbEnd as "from" | "to" | undefined;
    if (end && selectionRef.current.length === 1) {
      history.begin();
      gesture.current = { kind: "end", id: selectionRef.current[0], which: end };
      return;
    }
    const bend = (e.target as HTMLElement).closest<HTMLElement>("[data-wb-bend]")?.dataset.wbBend;
    if (bend !== undefined && selectionRef.current.length === 1) {
      const id = selectionRef.current[0];
      const route = routeOf(id, itemsRef.current, rectsRef.current);
      if (route) {
        // Dragging a line that touches a box: keep a short stub on the box and move the rest.
        const work = route.map((p) => ({ ...p }));
        let seg = Number(bend);
        if (seg === 0) {
          work.splice(1, 0, stub(work[0], work[1]));
          seg = 1;
        }
        if (seg === work.length - 2) work.splice(work.length - 1, 0, stub(work[work.length - 1], work[work.length - 2]));
        history.begin();
        gesture.current = { kind: "bend", id, work, seg, level: Math.abs(work[seg].y - work[seg + 1].y) < 0.5, start: world };
      }
      return;
    }
    const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-wb-handle]")?.dataset.wbHandle as Handle | undefined;
    if (handle && selectionRef.current.length === 1) {
      const id = selectionRef.current[0];
      const at = locate(itemsRef.current, id);
      const start = rectsRef.current.get(id);
      if (at && start) {
        history.begin();
        gesture.current = { kind: "resize", id, handle, start, inLayout: !!at.parent?.layout, text: at.item.type === "text" };
      }
      return;
    }
    const chain = chainAt(e.target);

    if (tool === "arrow") {
      // An arrow joins the innermost thing it starts on, or starts on the board itself.
      const from = itemUnder(e.clientX, e.clientY);
      gesture.current = { kind: "arrow", from, start: world, sx: e.clientX, sy: e.clientY };
      setArrowDraft({ from, start: world, ...world });
      return;
    }
    if (tool === "frame" || tool === "shape" || tool === "text" || tool === "sticky") {
      gesture.current = { kind: "create", tool, x0: world.x, y0: world.y, parent: frameAt(e.clientX, e.clientY, new Set()) };
      return;
    }

    // Select tool. Arrows are picked by their lines.
    const arrowId = (e.target as Element).closest?.("[data-wb-arrow]")?.getAttribute("data-wb-arrow");
    if (arrowId) {
      setSelection(e.shiftKey ? [...selectionRef.current, arrowId] : [arrowId]);
      // An arrow with an end left on the board can be dragged by its line.
      const a = locate(itemsRef.current, arrowId)?.item;
      if (!e.shiftKey && a && (a.start || a.end)) {
        history.begin();
        gesture.current = { kind: "slide", id: arrowId, start: world, orig: a };
      }
      return;
    }
    const hit = pick(chain, e.metaKey || e.ctrlKey);
    if (!hit) {
      if (e.pointerType === "touch") {
        gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, cam: camRef.current };
        if (!e.shiftKey) setSelection([]);
        return;
      }
      gesture.current = { kind: "marquee", x0: world.x, y0: world.y, additive: e.shiftKey, before: e.shiftKey ? selectionRef.current : [] };
      if (!e.shiftKey) setSelection([]);
      return;
    }
    let ids = selectionRef.current;
    if (e.shiftKey) {
      ids = ids.includes(hit) ? ids.filter((i) => i !== hit) : [...ids, hit];
      setSelection(ids);
      if (!ids.includes(hit)) return;
    } else if (!ids.includes(hit)) {
      ids = [hit];
      setSelection(ids);
    }
    const isArrow = locate(itemsRef.current, hit)?.item.type === "arrow";
    const rect = rectsRef.current.get(hit);
    if (isArrow || !rect) return;
    gesture.current = { kind: "press", ids: ids.filter((id) => locate(itemsRef.current, id)?.item.type !== "arrow"), primary: hit, sx: e.clientX, sy: e.clientY, alt: e.altKey, world, rect };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    const g = gesture.current;
    if (!g) {
      if (e.pointerType === "mouse" && tool === "select") {
        const id = pick(chainAt(e.target), e.metaKey || e.ctrlKey);
        if (id !== hover) setHover(id);
      }
      return;
    }
    const world = toWorld(e.clientX, e.clientY);
    switch (g.kind) {
      case "pan":
        setCam({ ...g.cam, x: g.cam.x + e.clientX - g.sx, y: g.cam.y + e.clientY - g.sy });
        break;
      case "pinch": {
        const touches = [...pointers.current.values()].filter((p) => p.type === "touch");
        if (touches.length < 2) break;
        const [a, b] = touches;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const r = viewRef.current!.getBoundingClientRect();
        const z = clampZ(g.cam.z * (dist / g.dist));
        // Keep the point between the fingers still, and follow them as they move.
        const wx = (g.mid.x - r.left - g.cam.x) / g.cam.z;
        const wy = (g.mid.y - r.top - g.cam.y) / g.cam.z;
        setCam({ z, x: mid.x - r.left - wx * z, y: mid.y - r.top - wy * z });
        break;
      }
      case "press": {
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 4) break;
        let ids = topSelected(g.ids);
        let primary = g.primary;
        if (g.alt) {
          // Option+drag: leave the originals where they are and drag copies.
          let next = itemsRef.current;
          const taken = allIds(next);
          const copies: string[] = [];
          const picked = ids.map((id) => locate(next, id)?.item).filter((i): i is Item => !!i);
          // Arrows between the copied items are copied too, joined to the copies.
          const made = cloneWithNewIds([...picked, ...arrowsAmong(next, picked)], taken);
          picked.forEach((item, n) => {
            const at = locate(next, item.id)!;
            next = insertItems(next, at.parent?.id ?? null, at.index + 1, [made[n]]);
            copies.push(made[n].id);
            if (item.id === g.primary) primary = made[n].id;
          });
          next = insertItems(next, null, next.length, made.slice(picked.length));
          commit(next);
          ids = copies;
          setSelection(ids);
        }
        const all = new Set<string>();
        for (const id of ids) {
          all.add(id);
          const at = locate(itemsRef.current, id);
          if (at?.item.children) walk(at.item.children, (c) => all.add(c.id));
        }
        gesture.current = { kind: "drag", ids, all, primary, grab: { x: g.world.x - g.rect.x, y: g.world.y - g.rect.y }, base: g.alt ? null : g.rect };
        setDrag({ ids: new Set(ids), dx: 0, dy: 0 });
        setHover(null);
        break;
      }
      case "drag": {
        const base = g.base ?? rectsRef.current.get(g.primary);
        if (!base) break;
        if (!g.base) g.base = base;
        setDrag({ ids: new Set(g.ids), dx: world.x - g.grab.x - base.x, dy: world.y - g.grab.y - base.y });
        const target = dropTargetAt(e.clientX, e.clientY, g.all);
        setDropLine(target.line);
        break;
      }
      case "marquee": {
        const box = { x: Math.min(g.x0, world.x), y: Math.min(g.y0, world.y), w: Math.abs(world.x - g.x0), h: Math.abs(world.y - g.y0) };
        setMarquee(box);
        const inside = itemsRef.current
          .filter((i) => i.type !== "arrow")
          .map((i) => i.id)
          .filter((id) => {
            const r = rectsRef.current.get(id);
            return r && r.x < box.x + box.w && r.x + r.w > box.x && r.y < box.y + box.h && r.y + r.h > box.y;
          });
        setSelection([...new Set([...g.before, ...inside])]);
        break;
      }
      case "resize": {
        const { start, handle } = g;
        let { x, y, w, h } = start;
        if (handle.includes("e")) w = Math.max(20, world.x - start.x);
        if (handle.includes("s")) h = Math.max(20, world.y - start.y);
        if (handle.includes("w")) {
          w = Math.max(20, start.x + start.w - world.x);
          x = start.x + start.w - w;
        }
        if (handle.includes("n")) {
          h = Math.max(20, start.y + start.h - world.y);
          y = start.y + start.h - h;
        }
        const at = locate(itemsRef.current, g.id);
        if (!at) break;
        const patch: Partial<Item> = {};
        if (handle.includes("e") || handle.includes("w")) patch.w = Math.round(w);
        if (!g.text && (handle.includes("n") || handle.includes("s"))) patch.h = Math.round(h);
        if (!g.inLayout) {
          if (handle.includes("w")) patch.x = Math.round((at.item.x ?? 0) + (x - (rectsRef.current.get(g.id)?.x ?? x)));
          if (handle.includes("n") && !g.text) patch.y = Math.round((at.item.y ?? 0) + (y - (rectsRef.current.get(g.id)?.y ?? y)));
        }
        history.live(mapItem(itemsRef.current, g.id, (i) => ({ ...i, ...patch })));
        break;
      }
      case "create": {
        if (g.tool === "frame" || g.tool === "shape") {
          const box = { x: Math.min(g.x0, world.x), y: Math.min(g.y0, world.y), w: Math.abs(world.x - g.x0), h: Math.abs(world.y - g.y0) };
          setDraft(box.w > 4 || box.h > 4 ? box : null);
        }
        break;
      }
      case "arrow":
        setArrowDraft({ from: g.from, start: g.start, ...world });
        break;
      case "end":
        history.live(mapItem(itemsRef.current, g.id, (a) => withEnd(a, g.which, null, world)));
        break;
      case "slide":
        history.live(mapItem(itemsRef.current, g.id, () => shiftArrow(g.orig, world.x - g.start.x, world.y - g.start.y)));
        break;
      case "bend":
        history.live(mapItem(itemsRef.current, g.id, (i) => ({ ...i, elbow: true, bends: bendsAfter(g, world) })));
        break;
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch") {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    gesture.current = null;
    const world = toWorld(e.clientX, e.clientY);
    switch (g.kind) {
      case "press": {
        // A click without a drag on something already selected: nothing more to do.
        break;
      }
      case "drag":
        finishDrag(g, e.clientX, e.clientY);
        break;
      case "marquee":
        setMarquee(null);
        break;
      case "resize":
        history.end();
        break;
      case "bend": {
        // Tidy away corners that no longer turn.
        const bends = bendsAfter(g, world);
        const tidy = tidyRoute([g.work[0], ...bends.map(([x, y]) => ({ x, y })), g.work[g.work.length - 1]]).slice(1, -1);
        history.live(mapItem(itemsRef.current, g.id, (i) => ({ ...i, elbow: true, bends: tidy.map((p) => [p.x, p.y] as [number, number]) })));
        history.end();
        break;
      }
      case "create": {
        const box = draft;
        setDraft(null);
        const taken = allIds(itemsRef.current);
        const id = newId(taken);
        let item: Item;
        let at = { x: g.x0, y: g.y0 };
        if (g.tool === "frame") {
          const w = box ? Math.round(box.w) : DEFAULTS.frame.w;
          const h = box ? Math.round(box.h) : DEFAULTS.frame.h;
          item = { id, type: "frame", w, h, children: [] };
          at = box ? { x: box.x, y: box.y } : { x: g.x0 - w / 2, y: g.y0 - h / 2 };
        } else if (g.tool === "shape") {
          const w = box ? Math.round(box.w) : DEFAULTS.shape.w;
          const h = box ? Math.round(box.h) : DEFAULTS.shape.h;
          item = { id, type: "shape", w, h, ...(shapeKind !== "rect" && { shape: shapeKind }) };
          at = box ? { x: box.x, y: box.y } : { x: g.x0 - w / 2, y: g.y0 - h / 2 };
        } else if (g.tool === "sticky") {
          item = { id, type: "sticky" };
          at = { x: g.x0 - DEFAULTS.sticky.w / 2, y: g.y0 - DEFAULTS.sticky.h / 2 };
        } else {
          item = { id, type: "text" };
          at = { x: g.x0, y: g.y0 - 14 };
        }
        addAt(item, g.parent, at);
        setTool("select");
        if (item.type === "text" || item.type === "sticky") setEditingId(id);
        break;
      }
      case "arrow": {
        setArrowDraft(null);
        const under = itemUnder(e.clientX, e.clientY);
        const to = under && under !== g.from ? under : null;
        // A click on its own makes nothing; a drag across empty board makes a free-standing arrow.
        if (to || Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 8) {
          const id = newId(allIds(itemsRef.current));
          let a: Item = { id, type: "arrow", ...(arrowKind === "elbow" && { elbow: true }), ...(lineOnly && { head: "none" as const }) };
          a = withEnd(a, "from", g.from, g.start);
          a = withEnd(a, "to", to, world);
          commit(insertItems(itemsRef.current, null, itemsRef.current.length, [a]));
          setSelection([id]);
        }
        setTool("select");
        break;
      }
      case "end": {
        const at = locate(itemsRef.current, g.id)?.item;
        if (at) {
          const under = itemUnder(e.clientX, e.clientY);
          const other = g.which === "from" ? at.to : at.from;
          history.live(mapItem(itemsRef.current, g.id, (a) => withEnd(a, g.which, under && under !== other ? under : null, world)));
        }
        history.end();
        break;
      }
      case "slide":
        history.end();
        break;
    }
    void world;
  }

  function finishDrag(g: Extract<Gesture, { kind: "drag" }>, cx: number, cy: number) {
    setDrag(null);
    setDropLine(null);
    const target = dropTargetAt(cx, cy, g.all);
    const moving = g.ids.filter((id) => locate(itemsRef.current, id));
    const now = new Map(moving.map((id) => [id, rectsRef.current.get(id)]));
    let next = itemsRef.current;
    // Arrows whose joined ends all moved take their bends and free ends along.
    const moved = now.get(g.primary);
    if (g.base && moved) {
      const dx = moved.x - g.base.x;
      const dy = moved.y - g.base.y;
      walk(itemsRef.current, (i) => {
        if (i.type === "arrow" && travels(i, (id) => g.all.has(id))) next = mapItem(next, i.id, (a) => shiftArrow(a, dx, dy));
      });
    }
    const sameParent = moving.every((id) => (locate(next, id)!.parent?.id ?? null) === target.parent);
    const targetFrame = target.parent ? locate(next, target.parent)!.item : null;

    if (sameParent && !targetFrame?.layout) {
      // Moved within the same place: just new positions.
      for (const id of moving) {
        const r = now.get(id);
        if (!r) continue;
        const pr = target.parent ? rectsRef.current.get(target.parent) : null;
        next = mapItem(next, id, (i) => ({ ...i, x: Math.round(r.x - (pr?.x ?? 0)), y: Math.round(r.y - (pr?.y ?? 0)) }));
      }
      commit(next);
      return;
    }
    const pulled = moving.map((id) => locate(next, id)!.item);
    next = removeOnly(next, new Set(moving));
    const pr = target.parent ? rectsRef.current.get(target.parent) : null;
    const placed = pulled.map((item) => {
      if (targetFrame?.layout) return omit(item, ["x", "y"]);
      const r = now.get(item.id);
      return { ...item, x: Math.round((r?.x ?? 0) - (pr?.x ?? 0)), y: Math.round((r?.y ?? 0) - (pr?.y ?? 0)) };
    });
    const index = targetFrame?.layout ? target.index : target.parent ? (targetFrame?.children?.length ?? 0) : next.length;
    next = insertItems(next, target.parent, index, placed);
    commit(next);
  }

  function cancelGesture() {
    const g = gesture.current;
    if (g?.kind === "resize" || g?.kind === "end" || g?.kind === "slide") history.end();
    gesture.current = null;
    setDrag(null);
    setDropLine(null);
    setMarquee(null);
    setDraft(null);
    setArrowDraft(null);
  }

  function onDoubleClick(e: React.MouseEvent) {
    if (tool !== "select") return;
    // The board holds on to the pointer while it's pressed, so the double-click's own target is the board.
    const chain = chainAt(document.elementFromPoint(e.clientX, e.clientY));
    if (!chain.length) {
      // Double-click on empty board: a new text.
      const world = toWorld(e.clientX, e.clientY);
      const id = newId(allIds(itemsRef.current));
      addAt({ id, type: "text" }, frameAt(e.clientX, e.clientY, new Set()), { x: world.x, y: world.y - 14 });
      setEditingId(id);
      return;
    }
    const current = pick(chain, false);
    const at = current ? locate(itemsRef.current, current) : null;
    if (!at) return;
    if (at.item.type === "frame") {
      const i = chain.indexOf(current!);
      if (chain[i + 1]) {
        const child = locate(itemsRef.current, chain[i + 1])!.item;
        setSelection([child.id]);
        if (child.type !== "frame" && child.type !== "arrow" && child.id === chain[chain.length - 1]) setEditingId(child.id);
      }
      return;
    }
    if (at.item.type !== "arrow") {
      setSelection([at.item.id]);
      setEditingId(at.item.id);
    }
  }

  // ---- Wheel: scroll to pan, pinch or Cmd+scroll to zoom ----
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-wb-ui]")) return;
      e.preventDefault();
      const c = camRef.current;
      if (e.ctrlKey || e.metaKey) {
        const r = view.getBoundingClientRect();
        const z = clampZ(c.z * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01)));
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        setCam({ z, x: px - ((px - c.x) / c.z) * z, y: py - ((py - c.y) / c.z) * z });
      } else setCam({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY });
    };
    view.addEventListener("wheel", onWheel, { passive: false });
    // Safari on a Mac reports a trackpad pinch as gesture events (with a running scale), not as Ctrl+wheel.
    type Pinch = Event & { scale: number; clientX: number; clientY: number };
    let start: { cam: Camera; scale: number } | null = null;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      start = { cam: camRef.current, scale: (e as Pinch).scale || 1 };
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (!start) return;
      const g = e as Pinch;
      const c = start.cam;
      const r = view.getBoundingClientRect();
      const z = clampZ(c.z * (g.scale / start.scale));
      const px = g.clientX - r.left;
      const py = g.clientY - r.top;
      // Keep the board point that was under the fingers when the pinch began under them.
      const cur = camRef.current;
      const wx = (px - cur.x) / cur.z;
      const wy = (py - cur.y) / cur.z;
      setCam({ z, x: px - wx * z, y: py - wy * z });
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      start = null;
    };
    view.addEventListener("gesturestart", onGestureStart);
    view.addEventListener("gesturechange", onGestureChange);
    view.addEventListener("gestureend", onGestureEnd);
    return () => {
      view.removeEventListener("wheel", onWheel);
      view.removeEventListener("gesturestart", onGestureStart);
      view.removeEventListener("gesturechange", onGestureChange);
      view.removeEventListener("gestureend", onGestureEnd);
    };
  }, [setCam]);

  const zoomBy = useCallback(
    (factor: number) => {
      const view = viewRef.current;
      if (!view) return;
      const c = camRef.current;
      const z = clampZ(c.z * factor);
      const px = view.clientWidth / 2;
      const py = view.clientHeight / 2;
      setCam({ z, x: px - ((px - c.x) / c.z) * z, y: py - ((py - c.y) / c.z) * z });
    },
    [setCam],
  );

  // ---- Keys ----
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  const onKey = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (editingId) {
      if (e.key === "Escape") (document.activeElement as HTMLElement | null)?.blur?.();
      return;
    }
    if (isTyping(e.target)) return;
    // The board has its own undo, so the app-wide one stays out of the way here.
    if (mod && key === "z") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.shiftKey) history.redo();
      else history.undo();
      const ids = allIds(itemsRef.current);
      setSelection(selectionRef.current.filter((id) => ids.has(id)));
      return;
    }
    if (mod && key === "y") {
      e.preventDefault();
      history.redo();
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      setSpaceDown(true);
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      deleteSelection();
      return;
    }
    if (e.key === "Escape") {
      if (tool !== "select") setTool("select");
      else if (selectionRef.current.length === 1) {
        const parent = ancestorsOf(itemsRef.current, selectionRef.current[0]).pop();
        setSelection(parent ? [parent] : []);
      } else setSelection([]);
      return;
    }
    if (e.key === "Enter" && selectionRef.current.length === 1) {
      const at = locate(itemsRef.current, selectionRef.current[0]);
      if (at?.item.type === "frame" && at.item.children?.length) setSelection(at.item.children.map((c) => c.id));
      else if (at && at.item.type !== "frame" && at.item.type !== "arrow") {
        e.preventDefault();
        setEditingId(at.item.id);
      }
      return;
    }
    if (mod && key === "a") {
      e.preventDefault();
      setSelection(itemsRef.current.map((i) => i.id));
      return;
    }
    if (mod && key === "d") {
      e.preventDefault();
      duplicate(selectionRef.current);
      return;
    }
    if (mod && (key === "c" || key === "x")) {
      const ids = topSelected();
      if (!ids.length) return;
      const picked = ids.map((id) => locate(itemsRef.current, id)!.item);
      setClipboard([...picked, ...arrowsAmong(itemsRef.current, picked)]);
      if (key === "x") deleteSelection();
      return;
    }
    if (mod && key === "v") {
      if (!clipboard.length) return;
      e.preventDefault();
      const taken = allIds(itemsRef.current);
      const copies = cloneWithNewIds(clipboard, taken).map((c) => (c.type === "arrow" ? shiftArrow(c, 24, 24) : { ...c, x: (c.x ?? 0) + 24, y: (c.y ?? 0) + 24 }));
      // An arrow comes along if each end did, or is on the board, or is still here to join to.
      const ids = new Set([...allIds(copies), ...taken]);
      const keep = copies.filter((c) => c.type !== "arrow" || ((!c.from || ids.has(c.from)) && (!c.to || ids.has(c.to))));
      commit(insertItems(itemsRef.current, null, itemsRef.current.length, keep));
      setSelection(keep.map((c) => c.id));
      return;
    }
    if (mod && (key === "=" || key === "+")) {
      e.preventDefault();
      zoomBy(1.25);
      return;
    }
    if (mod && key === "-") {
      e.preventDefault();
      zoomBy(0.8);
      return;
    }
    if (mod && key === "0") {
      e.preventDefault();
      zoomBy(1 / camRef.current.z);
      return;
    }
    if (e.shiftKey && e.code === "Digit1") {
      fit();
      return;
    }
    if (e.shiftKey && e.code === "Digit2") {
      if (selectionRef.current.length) fit(selectionRef.current);
      return;
    }
    if (e.shiftKey && key === "a" && !mod) {
      e.preventDefault();
      addAutoLayout();
      return;
    }
    if (e.key.startsWith("Arrow") && selectionRef.current.length) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      let next = itemsRef.current;
      for (const id of topSelected()) {
        const at = locate(next, id);
        if (!at || at.parent?.layout || at.item.type === "arrow") continue;
        next = mapItem(next, id, (i) => ({ ...i, x: (i.x ?? 0) + dx, y: (i.y ?? 0) + dy }));
      }
      commit(next);
      return;
    }
    if (mod || e.altKey) return;
    const tools: Record<string, Tool> = { v: "select", h: "hand", f: "frame", t: "text", s: "sticky", r: "shape", o: "shape", x: "arrow" };
    if (tools[key] && !e.shiftKey) {
      if (key === "r") setShapeKind("rect");
      if (key === "o") setShapeKind("ellipse");
      setTool(tools[key]);
    }
  };
  useLayoutEffect(() => {
    keyHandler.current = onKey;
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => keyHandler.current(e);
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceDown(false);
    };
    window.addEventListener("keydown", down, { capture: true });
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down, { capture: true });
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ---- Arrows ----
  const arrows = useMemo(() => {
    const list: Item[] = [];
    walk(items, (i) => {
      if (i.type === "arrow") list.push(i);
    });
    return list;
  }, [items]);

  /** The path an arrow takes, from the boxes it joins as they're drawn right now. */
  function routeOf(id: string, list: Item[], boxes: Map<string, Rect>): Point[] | null {
    const a = locate(list, id)?.item;
    if (!a || a.type !== "arrow") return null;
    // While what it joins is being dragged, its bends and free ends come along.
    const moving = (id: string) => !!drag && (drag.ids.has(id) || ancestorsOf(list, id).some((f) => drag.ids.has(f)));
    const shown = drag && travels(a, moving) ? shiftArrow(a, drag.dx, drag.dy) : a;
    const box = (joined?: string, at?: [number, number]) => (joined ? boxes.get(joined) : at ? { x: at[0], y: at[1], w: 0, h: 0 } : undefined);
    const from = box(a.from, shown.start);
    const to = box(a.to, shown.end);
    if (!from || !to) return null;
    return arrowRoute(shown, from, to);
  }

  const selectedItems = selection.map((id) => locate(items, id)?.item).filter(Boolean) as Item[];
  const single = selectedItems.length === 1 ? selectedItems[0] : null;
  const singleParent = single ? locate(items, single.id)?.parent ?? null : null;
  const cursor = spaceDown || tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair";

  async function rename(next: string) {
    const t = next.trim();
    if (t === board.title.trim()) return;
    try {
      await op("update_whiteboard", { id: board.id, title: t });
      router.refresh();
    } catch (err) {
      showToast((err as Error).message);
    }
  }

  async function remove() {
    try {
      await op("delete_whiteboard", { id: board.id });
      showTrashedToast("whiteboard", board.id, () => router.push(`/whiteboard/${board.id}`));
      router.push("/whiteboard");
    } catch (err) {
      showToast((err as Error).message);
    }
  }

  return (
    <div className="relative flex h-[calc(100dvh-3.5rem-env(safe-area-inset-bottom))] min-w-0 grow flex-col md:h-dvh">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-stroke bg-muted px-3 pt-[env(safe-area-inset-top)] md:px-4 box-content md:box-border md:pt-0">
        <Link
          href="/whiteboard"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-selected hover:text-foreground md:size-9"
          aria-label="All whiteboards"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(e) => rename(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder="Untitled"
          aria-label="Whiteboard name"
          className="h-9 min-w-0 grow rounded-lg bg-transparent px-2 text-base font-medium text-foreground outline-none placeholder:text-muted-foreground hover:bg-selected focus:bg-card md:text-control"
        />
        <button
          type="button"
          onClick={remove}
          aria-label="Move whiteboard to Trash"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-selected hover:text-danger md:size-9"
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </header>

      <div
        ref={viewRef}
        data-no-pull
        className="relative grow touch-none overflow-hidden select-none"
        style={{
          cursor,
          background: "var(--wb-canvas)",
          backgroundImage: "radial-gradient(var(--wb-dot) 1px, transparent 1px)",
          backgroundSize: `${24 * cam.z}px ${24 * cam.z}px`,
          backgroundPosition: `${cam.x}px ${cam.y}px`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          cancelGesture();
        }}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={onDoubleClick}
      >
        <div
          ref={worldRef}
          className="absolute top-0 left-0"
          style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`, transformOrigin: "0 0", ["--wb-z" as string]: cam.z }}
        >
          {items.map((item) => (
            <ItemView
              key={item.id}
              item={item}
              topLevel
              offset={drag?.ids.has(item.id) ? drag : null}
              dragging={drag?.ids ?? null}
              dragOffset={drag}
              editingId={editingId}
              onEdited={onEdited}
            />
          ))}
          <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1}>
            {arrows.map((a) => {
              const route = routeOf(a.id, items, rects);
              if (!route) return null;
              // The head is drawn as its own line rather than an SVG marker, which Safari leaves out.
              const d = a.head === "none" ? routeToPath(route) : `${routeToPath(route)} ${arrowHead(route)}`;
              const mid = routeMiddle(route);
              const selected = selection.includes(a.id);
              return (
                <g key={a.id} data-wb-arrow={a.id} className="pointer-events-auto">
                  <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                  <path
                    d={d}
                    fill="none"
                    stroke={selected ? "var(--wb-select)" : "var(--grey-600)"}
                    strokeWidth={selected ? 2.5 : 2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {a.text && (
                    <text
                      x={mid.x}
                      y={mid.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={14}
                      fill="var(--muted-foreground)"
                      stroke="var(--wb-canvas)"
                      strokeWidth={6}
                      paintOrder="stroke"
                    >
                      {a.text}
                    </text>
                  )}
                </g>
              );
            })}
            {arrowDraft && (() => {
              const r = arrowDraft.from ? rects.get(arrowDraft.from) : null;
              const route = [r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : arrowDraft.start, { x: arrowDraft.x, y: arrowDraft.y }];
              return (
                <g fill="none" stroke="var(--grey-600)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d={routeToPath(route)} strokeDasharray="6 6" />
                  {!lineOnly && <path d={arrowHead(route)} />}
                </g>
              );
            })()}
          </svg>
        </div>

        {/* Outlines, handles and guides, drawn at screen size. */}
        <div className="pointer-events-none absolute inset-0">
          {hover && !selection.includes(hover) && rects.get(hover) && <Box r={toScreen(rects.get(hover)!)} thin />}
          {selection.map((id) => {
            const r = rects.get(id);
            if (!r || locate(items, id)?.item.type === "arrow") return null;
            return <Box key={id} r={toScreen(r)} />;
          })}
          {single && !drag && !editingId && single.type !== "arrow" && rects.get(single.id) && (
            <Handles r={toScreen(rects.get(single.id)!)} textOnly={single.type === "text"} />
          )}
          {single?.type === "arrow" && single.elbow && !drag && <BendHandles route={routeOf(single.id, items, rects)} toScreen={(p) => ({ x: p.x * cam.z + cam.x, y: p.y * cam.z + cam.y })} />}
          {single?.type === "arrow" && !drag && <EndHandles route={routeOf(single.id, items, rects)} toScreen={(p) => ({ x: p.x * cam.z + cam.x, y: p.y * cam.z + cam.y })} />}
          {marquee && <Box r={toScreen(marquee)} thin fill />}
          {draft && <Box r={toScreen(draft)} thin />}
          {dropLine && (
            <div
              className="absolute bg-[var(--wb-select)]"
              style={{
                left: toScreen(dropLine).x - (dropLine.w ? 0 : 1),
                top: toScreen(dropLine).y - (dropLine.h ? 0 : 1),
                width: Math.max(2, toScreen(dropLine).w),
                height: Math.max(2, toScreen(dropLine).h),
              }}
            />
          )}
        </div>

        {(single || selectedItems.length > 1) && !drag && (
          <Panel
            items={selectedItems}
            parent={singleParent}
            onChange={(id, patch) => {
              if ("head" in patch) setLineOnly(patch.head === "none");
              update(id, patch);
            }}
            onLayout={setLayout}
            onAutoLayout={addAutoLayout}
            onDelete={deleteSelection}
          />
        )}

        <div data-wb-ui className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-stroke bg-card p-1">
          <ToolButton label="Select (V)" active={tool === "select"} onClick={() => setTool("select")} icon={MousePointer2} />
          <ToolButton label="Hand (H)" active={tool === "hand"} onClick={() => setTool("hand")} icon={Hand} className="hidden md:flex" />
          <ToolButton label="Frame (F)" active={tool === "frame"} onClick={() => setTool("frame")} icon={Frame} />
          <ToolButton label="Text (T)" active={tool === "text"} onClick={() => setTool("text")} icon={Type} />
          <ToolButton label="Sticky (S)" active={tool === "sticky"} onClick={() => setTool("sticky")} icon={StickyNote} />
          <ToolButton
            label="Shape (R)"
            active={tool === "shape"}
            onClick={() => {
              if (tool === "shape") setShapeKind(shapeKind === "rect" ? "ellipse" : shapeKind === "ellipse" ? "diamond" : "rect");
              setTool("shape");
            }}
            icon={shapeKind === "diamond" ? Diamond : Square}
            round={shapeKind === "ellipse"}
          />
          <ToolButton
            label={arrowKind === "elbow" ? "Elbow arrow (X)" : "Arrow (X)"}
            active={tool === "arrow"}
            onClick={() => {
              if (tool === "arrow") setArrowKind(arrowKind === "straight" ? "elbow" : "straight");
              setTool("arrow");
            }}
            icon={arrowKind === "elbow" ? CornerDownRight : MoveRight}
          />
          <span className="mx-1 h-6 w-px bg-border" />
          <ToolButton label="Undo" onClick={() => history.undo()} icon={Undo2} disabled={!history.canUndo} />
          <ToolButton label="Redo" onClick={() => history.redo()} icon={Redo2} disabled={!history.canRedo} className="hidden md:flex" />
        </div>

        <div data-wb-ui className="absolute right-3 bottom-3 hidden items-center gap-0.5 rounded-xl border border-stroke bg-card p-1 md:flex">
          <ToolButton label="Zoom out" onClick={() => zoomBy(0.8)} icon={Minus} />
          <button
            type="button"
            onClick={() => zoomBy(1 / cam.z)}
            className="h-9 w-14 rounded-[8px] text-meta text-muted-foreground tabular-nums hover:bg-muted"
            title="Zoom to 100%"
          >
            {Math.round(cam.z * 100)}%
          </button>
          <ToolButton label="Zoom in" onClick={() => zoomBy(1.25)} icon={Plus} />
          <ToolButton label="Fit (Shift+1)" onClick={() => fit()} icon={Maximize} />
        </div>
      </div>
    </div>
  );
}

function Box({ r, thin, fill }: { r: Rect; thin?: boolean; fill?: boolean }) {
  return (
    <div
      className="absolute"
      style={{
        left: r.x,
        top: r.y,
        width: r.w,
        height: r.h,
        outline: `${thin ? 1 : 1.5}px solid var(--wb-select)`,
        outlineOffset: thin ? 0 : 1,
        background: fill ? "color-mix(in srgb, var(--wb-select) 6%, transparent)" : undefined,
        opacity: thin && !fill ? 0.5 : 1,
      }}
    />
  );
}

function Handles({ r, textOnly }: { r: Rect; textOnly: boolean }) {
  const spots: [Handle, number, number, string][] = textOnly
    ? [
        ["w", 0, 0.5, "ew-resize"],
        ["e", 1, 0.5, "ew-resize"],
      ]
    : [
        ["nw", 0, 0, "nwse-resize"],
        ["n", 0.5, 0, "ns-resize"],
        ["ne", 1, 0, "nesw-resize"],
        ["e", 1, 0.5, "ew-resize"],
        ["se", 1, 1, "nwse-resize"],
        ["s", 0.5, 1, "ns-resize"],
        ["sw", 0, 1, "nesw-resize"],
        ["w", 0, 0.5, "ew-resize"],
      ];
  return (
    <>
      {spots.map(([h, fx, fy, cursor]) => (
        <div
          key={h}
          data-wb-handle={h}
          className="pointer-events-auto absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center md:size-4"
          style={{ left: r.x + r.w * fx, top: r.y + r.h * fy, cursor }}
        >
          <span className="size-2.5 rounded-[2px] border-[1.5px] border-[var(--wb-select)] bg-[var(--grey-0)]" />
        </div>
      ))}
    </>
  );
}

function ToolButton({
  label,
  icon: Icon,
  onClick,
  active,
  disabled,
  className,
  round,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  round?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex size-10 items-center justify-center rounded-[8px] text-subtle-foreground hover:bg-muted disabled:text-disabled md:size-9",
        active && "bg-selected text-ink hover:bg-selected",
        className,
      )}
    >
      {round ? <span className="size-4 rounded-full border-[1.75px] border-current" /> : <Icon className="size-[18px]" />}
    </button>
  );
}

/** A copy of an item without some fields. */
function omit(item: Item, keys: (keyof Item)[]): Item {
  const copy = { ...item };
  for (const k of keys) delete copy[k];
  return copy;
}

/** A point a short way along a line, for the stub left on a box when its line is dragged away. */
function stub(from: Point, to: Point): Point {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const t = Math.min(24, len / 2) / len;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** Whether an arrow moves along with a move: everything it's joined to is moving. */
function travels(a: Item, moving: (id: string) => boolean): boolean {
  const ends = [a.from, a.to].filter((e): e is string => !!e);
  return ends.length > 0 && ends.every(moving);
}

/** An arrow with one end joined to an item, or (with no item) left on the board at a point. */
function withEnd(a: Item, which: "from" | "to", joined: string | null, at: Point): Item {
  const place = which === "from" ? "start" : "end";
  const out = omit(a, [which, place]);
  return joined ? { ...out, [which]: joined } : { ...out, [place]: [Math.round(at.x), Math.round(at.y)] };
}

/** Round grips on the two ends of a selected arrow: drag one onto something to join it, or anywhere to leave it there. */
function EndHandles({ route, toScreen }: { route: Point[] | null; toScreen: (p: Point) => Point }) {
  if (!route || route.length < 2) return null;
  const ends: ["from" | "to", Point][] = [
    ["from", route[0]],
    ["to", route[route.length - 1]],
  ];
  return (
    <>
      {ends.map(([which, p]) => {
        const s = toScreen(p);
        return (
          <div
            key={which}
            data-wb-end={which}
            className="pointer-events-auto absolute flex size-7 -translate-x-1/2 -translate-y-1/2 cursor-crosshair items-center justify-center md:size-5"
            style={{ left: s.x, top: s.y }}
          >
            <span className="size-2.5 rounded-full border-[1.5px] border-[var(--wb-select)] bg-[var(--grey-0)]" />
          </div>
        );
      })}
    </>
  );
}

/** The bends of an elbow arrow while one of its lines is dragged: that line moves straight up and down, or side to side. */
function bendsAfter(g: Extract<Gesture, { kind: "bend" }>, world: Point): [number, number][] {
  const d = g.level ? world.y - g.start.y : world.x - g.start.x;
  return g.work
    .slice(1, -1)
    .map((p, i) => (i + 1 === g.seg || i + 1 === g.seg + 1 ? (g.level ? { x: p.x, y: p.y + d } : { x: p.x + d, y: p.y }) : p))
    .map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]);
}

/** Grips in the middle of each line of a selected elbow arrow: drag one to move that line. */
function BendHandles({ route, toScreen }: { route: Point[] | null; toScreen: (p: Point) => Point }) {
  if (!route) return null;
  return (
    <>
      {route.slice(1).map((q, i) => {
        const p = route[i];
        const a = toScreen(p);
        const b = toScreen(q);
        if (Math.hypot(b.x - a.x, b.y - a.y) < 16) return null;
        const level = Math.abs(p.y - q.y) < 0.5;
        return (
          <div
            key={i}
            data-wb-bend={i}
            className="pointer-events-auto absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center md:size-4"
            style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2, cursor: level ? "ns-resize" : "ew-resize" }}
          >
            <span className={cn("rounded-full border-[1.5px] border-[var(--wb-select)] bg-[var(--grey-0)]", level ? "h-2 w-3.5" : "h-3.5 w-2")} />
          </div>
        );
      })}
    </>
  );
}

export type { ItemType };
