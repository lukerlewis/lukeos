/**
 * Work or Life on the dashboard. It's chosen on each device: a computer starts on Work and a
 * phone on Life, and switching is remembered on that device (a cookie) until switched back.
 */
import type { Area } from "./task-fields";

export const AREA_COOKIE = "lukeos_area";

/** The area a device starts on before Luke switches: Life on phones, Work elsewhere. */
export function defaultAreaFor(userAgent: string | null): Area {
  return userAgent && /iPhone|iPod|Android.+Mobile|Mobile Safari/i.test(userAgent) ? "life" : "work";
}

export function parseArea(value: string | undefined | null): Area | null {
  return value === "work" || value === "life" ? value : null;
}

/** In the browser: the area this device is showing, for new tasks. */
export function currentArea(): Area {
  const saved = parseArea(document.cookie.match(new RegExp(`(?:^|; )${AREA_COOKIE}=(\\w+)`))?.[1]);
  return saved ?? defaultAreaFor(navigator.userAgent);
}

/** In the browser: remember the area on this device. */
export function rememberArea(area: Area) {
  document.cookie = `${AREA_COOKIE}=${area}; path=/; max-age=${60 * 60 * 24 * 400}; samesite=lax`;
}
