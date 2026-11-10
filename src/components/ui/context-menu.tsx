"use client";

import { Check, ChevronRight, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Dialog } from "./dialog";

/**
 * One line in a right-click menu. `items` makes it open a smaller menu beside
 * it (e.g. "Move to" a list); it can be a function that loads them, so a
 * project list is only fetched when it's wanted.
 */
export type MenuItem = {
  label: string;
  icon?: LucideIcon;
  /** A small coloured square before the label, e.g. a project's colour. */
  dot?: string;
  onSelect?: () => void;
  items?: MenuEntry[] | (() => Promise<MenuEntry[]>);
  /** Shows a tick, e.g. the list a task is already in. */
  checked?: boolean;
  disabled?: boolean;
};

/** A line, or "-" for a thin divider. Falsy entries are skipped, so `cond && {...}` works. */
export type MenuEntry = MenuItem | "-" | false | "" | 0 | null | undefined;

/** What the Mac app's "Ask Claude about this" is about. */
export type AskAbout = { kind: string; id: string; title: string };

type Open = { x: number; y: number; items: MenuEntry[]; key: number };

let current: Open | null = null;
const listeners = new Set<() => void>();
const set = (next: Open | null) => {
  current = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function closeContextMenu() {
  if (current) set(null);
}

/** Inside the LukeOS Mac app, which lets the page hand things to its Claude panel. */
type Desktop = { askClaude?: (item: AskAbout) => void };
const desktop = () => (typeof window === "undefined" ? undefined : (window as unknown as { lukeosDesktop?: Desktop }).lukeosDesktop);

/** Opens a menu at a point on screen. */
export function openContextMenu(x: number, y: number, items: MenuEntry[], ask?: AskAbout) {
  const mac = desktop();
  const all = ask && mac?.askClaude ? [...items, "-" as const, { label: "Ask Claude about this", icon: Sparkles, onSelect: () => mac.askClaude!(ask) }] : items;
  set({ x, y, items: tidy(all), key: Date.now() });
}

/** Drops empty entries and dividers that would sit at an edge or next to another. */
function tidy(entries: MenuEntry[]): (MenuItem | "-")[] {
  const out: (MenuItem | "-")[] = [];
  for (const e of entries) {
    if (!e) continue;
    if (e === "-" && (out.length === 0 || out.at(-1) === "-")) continue;
    out.push(e);
  }
  while (out.at(-1) === "-") out.pop();
  return out;
}

/** True when the right-click should get the browser's own menu: in a text box, or on selected text. */
function wantsNativeMenu(e: React.MouseEvent<HTMLElement>) {
  const t = e.target as HTMLElement;
  if (t.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return true;
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && sel.toString().trim() !== "" && e.currentTarget.contains(sel.anchorNode);
}

// A press and hold on a phone: one at a time, so this lives outside any one row.
let hold: { timer: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean } | null = null;
const HOLD_MS = 450;

/**
 * Props that give an element a right-click menu. `items` is only built when
 * the menu opens. With `hold`, a press and hold on a phone opens it too (leave
 * it off where holding already drags). A menu inside another wins over the
 * outer one. Text boxes and selected text keep the browser's own menu.
 */
export function contextMenu(items: () => MenuEntry[], { ask, hold: holdToOpen = false }: { ask?: AskAbout; hold?: boolean } = {}) {
  const props: {
    onContextMenu: React.MouseEventHandler<HTMLElement>;
    onTouchStart?: React.TouchEventHandler<HTMLElement>;
    onTouchMove?: React.TouchEventHandler<HTMLElement>;
    onTouchEnd?: React.TouchEventHandler<HTMLElement>;
    onTouchCancel?: React.TouchEventHandler<HTMLElement>;
    "data-hold-menu"?: "";
  } = {
    onContextMenu: (e) => {
      if (e.defaultPrevented || wantsNativeMenu(e)) return;
      e.preventDefault();
      // A press and hold already opened it (Android sends a right-click too).
      if (hold?.fired) return;
      openContextMenu(e.clientX, e.clientY, items(), ask);
    },
  };
  if (!holdToOpen) return props;
  const cancel = () => {
    if (hold && !hold.fired) clearTimeout(hold.timer);
    if (hold && !hold.fired) hold = null;
  };
  props["data-hold-menu"] = "";
  props.onTouchStart = (e) => {
    if (e.touches.length !== 1 || (e.target as HTMLElement).closest("input, textarea, [contenteditable='true']")) return;
    if (hold) clearTimeout(hold.timer);
    const { clientX: x, clientY: y } = e.touches[0];
    const h = {
      x,
      y,
      fired: false,
      timer: setTimeout(() => {
        h.fired = true;
        navigator.vibrate?.(8);
        openContextMenu(x, y, items(), ask);
      }, HOLD_MS),
    };
    hold = h;
  };
  props.onTouchMove = (e) => {
    if (!hold || hold.fired) return;
    const t = e.touches[0];
    if (Math.hypot(t.clientX - hold.x, t.clientY - hold.y) > 10) cancel();
  };
  props.onTouchEnd = (e) => {
    if (hold?.fired) {
      // The finger lifting shouldn't also tap the row underneath.
      if (e.cancelable) e.preventDefault();
      const h = hold;
      setTimeout(() => hold === h && (hold = null), 400);
      return;
    }
    cancel();
  };
  props.onTouchCancel = cancel;
  return props;
}

/** Copies a link to a LukeOS page, e.g. "/notes/abc". */
export async function copyLink(path: string, done?: (message: string) => void) {
  const url = new URL(path, window.location.origin).toString();
  try {
    await navigator.clipboard.writeText(url);
    done?.("Link copied");
  } catch {
    done?.("Couldn't copy the link");
  }
}

type Rename = { label: string; value: string; save: (name: string) => void; key: number };
let renaming: Rename | null = null;
const renameListeners = new Set<() => void>();
const setRenaming = (next: Rename | null) => {
  renaming = next;
  renameListeners.forEach((l) => l());
};

/**
 * Opens a small box to type a new name, e.g. "Rename" in a menu. `save` gets
 * the trimmed name, only when it's changed and not empty.
 */
export function askRename(label: string, value: string, save: (name: string) => void) {
  setRenaming({ label, value, save, key: Date.now() });
}

function RenameDialog({ rename }: { rename: Rename }) {
  const [name, setName] = useState(rename.value);
  const close = () => setRenaming(null);
  return (
    <Dialog label={rename.label} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const clean = name.trim();
          close();
          if (clean && clean !== rename.value.trim()) rename.save(clean);
        }}
        className="flex flex-col gap-4 px-5 pt-5"
      >
        <h2 className="text-lg font-medium">{rename.label}</h2>
        <input
          autoFocus
          aria-label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          className="h-10 rounded-lg border bg-card px-3 text-body border-stroke-strong outline-none md:text-control focus-visible:border-ring"
        />
        <div className="-mx-5 flex items-center justify-end gap-2 border-t px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  );
}

const MENU_W = 220;
const EDGE = 8;

/** Lives once in the app's frame and draws whichever menu is open. */
export function ContextMenuHost() {
  const open = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const rename = useSyncExternalStore(
    (l) => {
      renameListeners.add(l);
      return () => void renameListeners.delete(l);
    },
    () => renaming,
    () => null,
  );
  return (
    <>
      {open && createPortal(<Menu key={open.key} at={{ x: open.x, y: open.y }} entries={open.items} root />, document.body)}
      {rename && <RenameDialog key={rename.key} rename={rename} />}
    </>
  );
}

function Menu({
  at,
  entries,
  root = false,
  autoFocus = root,
  flipFrom,
  onBack,
}: {
  at: { x: number; y: number };
  entries: MenuEntry[] | (() => Promise<MenuEntry[]>);
  root?: boolean;
  /** Puts the keyboard on the first line: the first menu, or a smaller one opened from the keyboard. */
  autoFocus?: boolean;
  /** For a smaller menu: the left edge of its parent, so it can open on that side when there's no room on the right. */
  flipFrom?: number;
  /** Closes this smaller menu and goes back to its parent (left arrow). */
  onBack?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; maxHeight: number; up: boolean; leftward: boolean } | null>(null);
  const [loaded, setLoaded] = useState<(MenuItem | "-")[] | null>(typeof entries === "function" ? null : tidy(entries));
  const [failed, setFailed] = useState(false);
  const [sub, setSub] = useState<{ index: number; at: { x: number; y: number }; flipFrom: number; focus: boolean } | null>(null);

  useEffect(() => {
    if (typeof entries !== "function") return;
    let live = true;
    entries().then(
      (list) => live && setLoaded(tidy(list)),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [entries]);

  // Once drawn, measure it and keep it on screen: open up or left when there's no room below or right.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.scrollHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = at.x;
    let leftward = false;
    if (left + w > vw - EDGE) {
      leftward = true;
      left = flipFrom !== undefined ? flipFrom - w + 4 : at.x - w;
    }
    left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
    let top = at.y;
    let up = false;
    if (top + h > vh - EDGE) {
      if (root && at.y - h >= EDGE) {
        top = at.y - h;
        up = true;
      } else top = Math.max(EDGE, vh - h - EDGE);
    }
    setPlace({ left, top, maxHeight: vh - EDGE * 2, up, leftward });
  }, [at.x, at.y, flipFrom, root, loaded]);

  // The first menu takes the keyboard and closes on a click outside, a scroll or Escape.
  useEffect(() => {
    if (!root) return;
    const outside = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-context-menu]")) closeContextMenu();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeContextMenu();
      }
    };
    const scroll = (e: Event) => {
      if (!(e.target instanceof Element && e.target.closest("[data-context-menu]"))) closeContextMenu();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", closeContextMenu);
    window.addEventListener("blur", closeContextMenu);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", closeContextMenu);
      window.removeEventListener("blur", closeContextMenu);
    };
  }, [root]);

  const ready = !!place && !!loaded;
  useEffect(() => {
    if (ready && autoFocus) box.current?.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus({ preventScroll: true });
  }, [ready, autoFocus]);

  function openSub(index: number, el: HTMLElement, focus: boolean) {
    const r = el.getBoundingClientRect();
    const menu = box.current!.getBoundingClientRect();
    setSub({ index, at: { x: menu.right - 4, y: r.top - 5 }, flipFrom: menu.left, focus });
  }

  function keys(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(":scope > [role=menuitem]:not(:disabled)")];
    const i = items.indexOf(document.activeElement as HTMLElement);
    // Keys pressed in the menu stay in it, so a screen's own shortcuts (Delete on a whiteboard) don't fire too.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      closeContextMenu();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === "ArrowLeft" && onBack) {
      e.preventDefault();
      e.stopPropagation();
      onBack();
    } else if (e.key === "Tab") {
      e.preventDefault();
    }
  }

  const list = loaded;
  const entry = sub && list ? list[sub.index] : null;
  const subItem = entry && entry !== "-" ? entry : null;

  return (
    <>
      <div
        ref={box}
        role="menu"
        data-context-menu=""
        onKeyDown={keys}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          left: place?.left ?? at.x,
          top: place?.top ?? at.y,
          maxHeight: place?.maxHeight,
          minWidth: MENU_W,
          visibility: place ? undefined : "hidden",
        }}
        className={cn(
          "fixed z-[60] flex max-w-72 flex-col overflow-y-auto overscroll-contain rounded-xl border border-stroke bg-card p-1",
          root && "motion-pop",
          place?.up ? (place.leftward ? "origin-bottom-right" : "origin-bottom-left") : place?.leftward ? "origin-top-right" : "origin-top-left",
        )}
      >
        {!list && (
          <div className="flex h-9 items-center px-2.5 text-preview text-muted-foreground">{failed ? "Couldn't load" : "Loading…"}</div>
        )}
        {list?.length === 0 && <div className="flex h-9 items-center px-2.5 text-preview text-muted-foreground">Nothing here</div>}
        {list?.map((e, i) =>
          e === "-" ? (
            <div key={i} role="separator" className="mx-2.5 my-1 h-px shrink-0 bg-border" />
          ) : (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={e.disabled}
              aria-haspopup={e.items ? "menu" : undefined}
              aria-expanded={e.items ? sub?.index === i : undefined}
              onPointerEnter={(ev) => {
                if (ev.pointerType !== "mouse") return;
                ev.currentTarget.focus({ preventScroll: true });
                if (e.items) {
                  if (sub?.index !== i) openSub(i, ev.currentTarget, false);
                } else if (sub) setSub(null);
              }}
              onKeyDown={(ev) => {
                if (e.items && (ev.key === "ArrowRight" || ev.key === "Enter" || ev.key === " ")) {
                  ev.preventDefault();
                  ev.stopPropagation();
                  openSub(i, ev.currentTarget, true);
                }
              }}
              onClick={(ev) => {
                if (e.items) return openSub(i, ev.currentTarget, ev.detail === 0);
                closeContextMenu();
                e.onSelect?.();
              }}
              className={cn(
                "press-tint flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-preview outline-none hover:bg-muted focus-visible:bg-muted disabled:text-muted-foreground disabled:hover:bg-transparent",
                sub?.index === i && "bg-muted",
              )}
            >
              {e.icon ? (
                <e.icon className="size-4 shrink-0 text-icon" aria-hidden />
              ) : e.dot ? (
                <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
                  <span className="size-2.5 rounded-[3px]" style={{ background: e.dot }} />
                </span>
              ) : null}
              <span className="min-w-0 grow truncate">{e.label}</span>
              {e.checked && <Check className="size-4 shrink-0 text-icon" aria-label="Current" />}
              {e.items && <ChevronRight className="-mr-1 size-4 shrink-0 text-icon" aria-hidden />}
            </button>
          ),
        )}
      </div>
      {subItem?.items && sub && (
        <Menu
          key={sub.index}
          at={sub.at}
          flipFrom={sub.flipFrom}
          entries={subItem.items}
          autoFocus={sub.focus}
          onBack={() => {
            const i = sub.index;
            setSub(null);
            box.current?.querySelectorAll<HTMLElement>(":scope > [role=menuitem]")[itemIndex(list!, i)]?.focus();
          }}
        />
      )}
    </>
  );
}

/** Which menuitem button (dividers left out) line `i` is. */
function itemIndex(list: (MenuItem | "-")[], i: number) {
  return list.slice(0, i).filter((e) => e !== "-").length;
}
