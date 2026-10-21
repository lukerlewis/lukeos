// Runs inside the LukeOS web app. Lets the page know it's in the Mac app, and
// tells the app what was right-clicked so it can offer "Ask Claude about this".

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lukeosDesktop", {
  /** Opens the Claude panel with this item ready to ask about. */
  askClaude: (item) => ipcRenderer.send("site:ask", clean(item)),
});

function clean(item) {
  return {
    kind: String(item?.kind ?? "item").slice(0, 40),
    id: String(item?.id ?? "").slice(0, 100),
    title: String(item?.title ?? "").slice(0, 300),
  };
}

window.addEventListener(
  "contextmenu",
  (e) => {
    const el = e.target instanceof Element ? e.target.closest("[data-ask-claude]") : null;
    let item = null;
    if (el) {
      try {
        item = clean(JSON.parse(el.getAttribute("data-ask-claude")));
      } catch {}
    }
    ipcRenderer.send("site:context", item);
  },
  true,
);
