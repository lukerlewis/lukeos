"use client";

import { useSyncExternalStore } from "react";

// Uses the device's own clock and time zone, so it's rendered in the browser.
const subscribe = () => () => {};

function greetingFor(date: Date) {
  const h = date.getHours();
  if (h < 12) return "Good morning, Luke";
  if (h < 18) return "Good afternoon, Luke";
  return "Good evening, Luke";
}

export function TodayDate() {
  return useSyncExternalStore(
    subscribe,
    () => new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
    () => " ",
  );
}

export function Greeting() {
  return useSyncExternalStore(subscribe, () => greetingFor(new Date()), () => "Hello, Luke");
}
