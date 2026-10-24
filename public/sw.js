// LukeOS service worker. It handles notifications, and makes opening the app
// instant: each screen is saved on the device as it loads, and opening the app
// shows the saved copy at once while a fresh one loads. The page then fetches
// its data again in the background (src/components/shell/keep-fresh.tsx).

const PAGES = "lukeos-pages-v1";
const FILES = "lukeos-files-v1";
const MAX_PAGES = 40;
const MAX_FILES = 400;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Screens that are never saved: signing in, Claude's sign-in, and the API.
const NOT_SAVED = /^\/(sign-in|oauth|api|\.well-known)(\/|$)/;

// When each screen was last shown from the saved copy. If it's asked for again
// straight away (the app reloading itself after an update), it goes to the
// server instead, so an old copy can't keep coming back.
const shownFromSave = new Map();

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Signing out forgets every saved screen.
  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    event.waitUntil(caches.delete(PAGES));
    return;
  }
  if (request.method !== "GET") return;

  // The app's code, fonts and styles never change once made (each version has
  // its own name), so keep them, and older saved screens still work after an update.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(fromSaveFirst(request));
    return;
  }

  if (request.mode === "navigate" && !NOT_SAVED.test(url.pathname)) {
    event.respondWith(openScreen(event, request));
  }
});

async function openScreen(event, request) {
  const cache = await caches.open(PAGES);
  const key = request.url;
  // Copy the fresh page as it arrives, and save the copy in the background,
  // so the screen still streams in as it loads.
  const network = fetch(request).then((response) => ({
    response,
    copy: savable(response) ? response.clone() : null,
  }));
  const fresh = network.then(({ response }) => response);
  event.waitUntil(
    network
      .then(async ({ response, copy }) => {
        if (copy) {
          await cache.put(key, copy);
          await trim(cache, MAX_PAGES);
        } else if (response.type === "opaqueredirect") {
          // Sent to sign in: the saved screens are no use any more.
          await caches.delete(PAGES);
        }
      })
      .catch(() => {}),
  );

  const lastShown = shownFromSave.get(key) ?? 0;
  const saved = Date.now() - lastShown > 10_000 ? await cache.match(key) : undefined;
  if (!saved) return fresh;
  shownFromSave.set(key, Date.now());
  return saved;
}

function savable(response) {
  return (
    response.ok &&
    response.type === "basic" &&
    (response.headers.get("content-type") || "").includes("text/html")
  );
}

async function fromSaveFirst(request) {
  const cache = await caches.open(FILES);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
    await trim(cache, MAX_FILES);
  }
  return response;
}

// Forget the oldest entries once a store gets big.
async function trim(cache, max) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "LukeOS";
  const url = data.url || "/messages";
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body: data.body || "",
        tag: data.tag,
        renotify: Boolean(data.tag),
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { url },
      });
      if (typeof data.badge === "number" && "setAppBadge" in navigator) {
        await (data.badge > 0 ? navigator.setAppBadge(data.badge) : navigator.clearAppBadge()).catch(() => {});
      }
      // Any open LukeOS window refreshes, so a new message appears straight away.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) client.postMessage({ type: "lukeos:push", url });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/messages", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
