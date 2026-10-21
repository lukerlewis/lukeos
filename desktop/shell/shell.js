// The top bar and the Claude panel. Claude Code itself runs in the main
// process; this only draws it and passes keys back and forth.

const $ = (id) => document.getElementById(id);
const pick = (lib, name) => (lib && lib[name]) || lib;

const term = new (pick(window.Terminal, "Terminal"))({
  fontFamily: '"SF Mono", Menlo, monospace',
  fontSize: 13,
  lineHeight: 1.25,
  cursorBlink: true,
  allowProposedApi: true,
  macOptionIsMeta: true,
  scrollback: 5000,
  theme: {
    background: "#121212",
    foreground: "#e8e8e8",
    cursor: "#e8e8e8",
    cursorAccent: "#121212",
    selectionBackground: "#454545",
  },
});
const fit = new (pick(window.FitAddon, "FitAddon"))();
term.loadAddon(fit);
term.loadAddon(new (pick(window.WebLinksAddon, "WebLinksAddon"))((_e, url) => window.open(url)));
term.open($("terminal"));

const size = () => ({ cols: term.cols, rows: term.rows });
function refit() {
  if ($("panel").hidden) return;
  try {
    fit.fit();
  } catch {}
  window.shell.ptyResize(size());
}

// What Enter does when Claude isn't running.
let waiting = null;

term.onData((data) => {
  if (waiting) {
    if (data === "\r") {
      const action = waiting;
      waiting = null;
      term.write("\r\n");
      action === "install" ? window.shell.ptyInstall() : window.shell.ptyRestart();
    }
    return;
  }
  window.shell.ptyInput(data);
});

window.shell.onPtyData((data) => term.write(data));
window.shell.onPtyClear(() => term.reset());
window.shell.onPtyExit(({ notFound }) => {
  if (notFound) {
    term.write("\r\n\x1b[1mClaude Code isn't on this Mac yet.\x1b[0m\r\nPress Enter to install it.\r\n");
    waiting = "install";
  } else {
    term.write("\r\n\x1b[2mClaude closed. Press Enter to start it again.\x1b[0m\r\n");
    waiting = "restart";
  }
});

// ---------- Panel ----------

window.shell.onPanelState(({ open, width }) => {
  $("panel").hidden = !open;
  $("panel").style.width = `${width}px`;
  $("toggle").setAttribute("aria-pressed", String(open));
  requestAnimationFrame(refit);
});
window.shell.onPanelFocus(() => term.focus());
$("toggle").addEventListener("click", () => window.shell.togglePanel());

// Drag the panel's left edge to make it wider or narrower.
$("handle").addEventListener("pointerdown", (e) => {
  const handle = $("handle");
  handle.setPointerCapture(e.pointerId);
  handle.classList.add("dragging");
  const move = (ev) => window.shell.setPanelWidth(window.innerWidth - ev.clientX);
  const up = () => {
    handle.classList.remove("dragging");
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    window.shell.panelWidthDone();
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
});

window.addEventListener("resize", refit);

// ---------- Top bar ----------

$("back").addEventListener("click", () => window.shell.back());
$("forward").addEventListener("click", () => window.shell.forward());
window.shell.onSiteNav(({ title, canGoBack, canGoForward }) => {
  $("title").textContent = title || "LukeOS";
  $("back").disabled = !canGoBack;
  $("forward").disabled = !canGoForward;
});

requestAnimationFrame(() => {
  try {
    fit.fit();
  } catch {}
  window.shell.ptyReady(size());
});
