"use client";

import { useSyncExternalStore } from "react";
import { isActive, mainNav, moreNav, phoneTabs } from "@/components/shell/nav";
import { PHONE_QUERY } from "@/lib/breakpoint";

/**
 * Where Luke was in each section (the open note, document, board, filters, and
 * how far down he'd scrolled), so leaving Notes for the Dashboard and coming
 * back opens the same note again. Kept on the device, per section.
 */
type Place = { url: string; scroll: number };
type Places = Record<string, Place>;

const STORE = "lukeos_places";
/** The phone's More tab covers several sections, so it remembers under its own name. */
export const MORE_TAB = "more";

const moreTab = phoneTabs.find((t) => t.label === "More")!;
const sections = [...mainNav, ...moreNav].map((n) => n.href as string).concat("/trash", "/settings");

/** The sections a page belongs to: its sidebar row, its phone tab, and its own project. */
function sectionsFor(pathname: string) {
  const keys = sections.filter((href) => isActive(pathname, href));
  if ([moreTab.href, ...moreTab.also].some((href) => isActive(pathname, href))) keys.push(MORE_TAB);
  const project = pathname.match(/^\/projects\/[^/]+$/);
  if (project) keys.push(project[0]);
  return keys;
}

/** The address worth coming back to: one-off bits (make a new note, open a task) are dropped. */
function keepable(pathname: string, search: string) {
  if (pathname.endsWith("/new")) return null;
  const params = new URLSearchParams(search);
  if (params.get("new") === "1") ["new", "title", "project", "folder"].forEach((k) => params.delete(k));
  params.delete("task");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

let cache: Places | null = null;
const listeners = new Set<() => void>();

function read(): Places {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Places;
  } catch {
    cache = {};
  }
  return cache;
}

function write(places: Places) {
  cache = places;
  try {
    localStorage.setItem(STORE, JSON.stringify(places));
  } catch {}
  listeners.forEach((l) => l());
}

/** Notes where Luke now is. Called on every move within the app. */
export function rememberPlace(pathname: string, search: string) {
  const url = keepable(pathname, search);
  if (!url) return;
  const places = read();
  const next = { ...places };
  let changed = false;
  for (const key of sectionsFor(pathname)) {
    if (places[key]?.url === url) continue;
    next[key] = { url, scroll: 0 };
    changed = true;
  }
  if (changed) write(next);
}

/** Forgets a page that's gone (a deleted note, say), so its section opens at the top again. */
export function forgetPlace(pathname: string) {
  const places = read();
  const next = Object.fromEntries(Object.entries(places).filter(([, p]) => p.url.split("?")[0] !== pathname));
  if (Object.keys(next).length !== Object.keys(places).length) write(next);
}

/** The bit of the screen that scrolls: the main column on computers, the whole page on phones. */
export function scroller(): Element | null {
  return window.matchMedia(PHONE_QUERY).matches ? document.scrollingElement : document.querySelector("main");
}

/** Keeps how far down the current page is scrolled. Only the latest page of each section is kept. */
export function rememberScroll() {
  const el = scroller();
  if (!el) return;
  const url = keepable(window.location.pathname, window.location.search);
  const places = read();
  const next = { ...places };
  let changed = false;
  for (const key of sectionsFor(window.location.pathname)) {
    if (places[key]?.url !== url || places[key].scroll === el.scrollTop) continue;
    next[key] = { url, scroll: el.scrollTop };
    changed = true;
  }
  // Scroll fires often, so this one saves quietly: links read the address, which hasn't changed.
  if (changed) {
    cache = next;
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {}
  }
}

/** A scroll to put back once the page Luke is heading to has drawn. */
let pending: Place | null = null;
export const takePendingScroll = (url: string) => {
  const p = pending?.url === url ? pending : null;
  pending = null;
  return p;
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/**
 * Where a sidebar row or phone tab should go: back to the last page in that
 * section, unless Luke is already in it (then it goes to the section's start).
 */
export function useSectionLink(href: string, key: string, active: boolean) {
  const url = useSyncExternalStore(
    subscribe,
    () => read()[key]?.url,
    () => undefined,
  );
  const target = !active && url ? url : href;
  const onClick = () => {
    const place = read()[key];
    pending = !active && place?.scroll ? place : null;
  };
  return { href: target, onClick };
}
