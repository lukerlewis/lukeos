// LukeOS for Mac. The live web app fills the window; on the right a panel runs
// Claude Code (the real CLI, signed in with Luke's own subscription), which
// reaches LukeOS through the same connector Claude uses everywhere else.

const { app, BrowserWindow, WebContentsView, Menu, ipcMain, shell, nativeTheme } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const pty = require("node-pty");

const SITE = process.env.LUKEOS_URL || "https://lukeos-kappa.vercel.app";
const BAR_HEIGHT = 44;
const PANEL = { min: 320, max: 900, start: 440 };
const INSTALL_COMMAND = "curl -fsSL https://claude.ai/install.sh | bash";

let win = null;
let site = null;
let term = null;
let termSize = { cols: 80, rows: 24 };
let panelOpen = true;
let panelWidth = PANEL.start;
let lastContext = null;
// Text to type into Claude once it has started, e.g. from "Ask Claude about this".
let pending = null;
let restarting = false;

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    if (typeof saved.panelOpen === "boolean") panelOpen = saved.panelOpen;
    if (typeof saved.panelWidth === "number") panelWidth = clampWidth(saved.panelWidth);
  } catch {}
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify({ panelOpen, panelWidth }));
  } catch {}
}

function clampWidth(w) {
  return Math.round(Math.min(PANEL.max, Math.max(PANEL.min, w)));
}

/** Claude Code runs in ~/LukeOS, with a short note telling it where it is. */
function workspace() {
  const dir = path.join(os.homedir(), "LukeOS");
  fs.mkdirSync(dir, { recursive: true });
  const notes = path.join(dir, "CLAUDE.md");
  if (!fs.existsSync(notes)) {
    fs.writeFileSync(
      notes,
      [
        "# LukeOS Mac app",
        "",
        "You're running in the Claude panel of the LukeOS Mac app, beside Luke's LukeOS.",
        "Use the LukeOS connector's tools to read and change his tasks, notes, documents, whiteboards and the rest.",
        "Follow the connector's own instructions (skills, context files, third person, get_today first).",
        "When a message starts with \"About the LukeOS ...\", that's the item Luke right-clicked in the app.",
        "",
      ].join("\n"),
    );
  }
  return dir;
}

// ---------- The window ----------

function layout() {
  if (!win || !site) return;
  const [w, h] = win.getContentSize();
  const right = panelOpen ? Math.min(panelWidth, w - 360) : 0;
  site.setBounds({ x: 0, y: BAR_HEIGHT, width: Math.max(0, w - right), height: Math.max(0, h - BAR_HEIGHT) });
  win.webContents.send("panel:state", { open: panelOpen, width: right });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: "LukeOS",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 15 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121212" : "#f8f8f8",
    webPreferences: {
      preload: path.join(__dirname, "preload-shell.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, "shell", "shell.html"));
  // Links Claude prints in the panel open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  site = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload-site.js"),
      partition: "persist:lukeos",
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.contentView.addChildView(site);
  site.webContents.loadURL(SITE);

  const sendNav = () => {
    if (!win || win.isDestroyed()) return;
    const nav = site.webContents.navigationHistory;
    win.webContents.send("site:nav", {
      title: site.webContents.getTitle().replace(/ · LukeOS$/, ""),
      canGoBack: nav.canGoBack(),
      canGoForward: nav.canGoForward(),
    });
  };
  site.webContents.on("page-title-updated", sendNav);
  site.webContents.on("did-navigate", sendNav);
  site.webContents.on("did-navigate-in-page", sendNav);

  // LukeOS stays in the window; every other site opens in the normal browser.
  const isOurs = (url) => {
    try {
      return new URL(url).origin === new URL(SITE).origin;
    } catch {
      return false;
    }
  };
  site.webContents.setWindowOpenHandler(({ url }) => {
    if (isOurs(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  site.webContents.on("will-navigate", (e, url) => {
    if (!isOurs(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  site.webContents.on("context-menu", (_e, params) => {
    // The page reports what was right-clicked a moment before this fires.
    setTimeout(() => showContextMenu(params), 40);
  });

  win.on("resize", layout);
  win.webContents.on("did-finish-load", () => {
    layout();
    sendNav();
  });
  win.on("closed", () => {
    win = null;
    site = null;
  });
  layout();
}

function showContextMenu(params) {
  const items = [];
  const context = lastContext && Date.now() - lastContext.at < 1000 ? lastContext.item : null;
  const selection = params.selectionText && params.selectionText.trim();

  if (context) items.push({ label: "Ask Claude about this", click: () => askClaude(aboutItem(context)) });
  if (selection) items.push({ label: "Ask Claude about this text", click: () => askClaude(aboutText(selection)) });
  if (!context && !selection) items.push({ label: "Ask Claude about this page", click: () => askClaude(aboutPage()) });
  items.push({ type: "separator" });

  if (params.isEditable) {
    items.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" });
  } else if (selection) {
    items.push({ role: "copy" });
  }
  if (params.linkURL) {
    items.push({ label: "Copy link", click: () => require("electron").clipboard.writeText(params.linkURL) });
  }
  if (items[items.length - 1].type === "separator") items.pop();
  Menu.buildFromTemplate(items).popup({ window: win });
}

function aboutItem(item) {
  return `About the LukeOS ${item.kind} "${item.title}" (id ${item.id}): `;
}

function aboutText(text) {
  const short = text.length > 600 ? `${text.slice(0, 600)}…` : text;
  return `About this from LukeOS (${site.webContents.getURL()}): "${short.replace(/\s+/g, " ")}" `;
}

function aboutPage() {
  return `About the LukeOS page "${site.webContents.getTitle()}" (${site.webContents.getURL()}): `;
}

function setPanel(open) {
  panelOpen = open;
  saveSettings();
  layout();
  if (open) win?.webContents.send("panel:focus");
  else site?.webContents.focus();
}

// ---------- Claude Code ----------

function startClaude(command = "claude") {
  if (term) return;
  const userShell = process.env.SHELL || "/bin/zsh";
  const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" };
  // Apps opened from the Dock don't get the Terminal's PATH; the login shell fixes most of it.
  env.PATH = [path.join(os.homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", env.PATH].join(":");
  delete env.ELECTRON_RUN_AS_NODE;

  term = pty.spawn(userShell, ["-l", "-i", "-c", command], {
    name: "xterm-256color",
    cols: termSize.cols,
    rows: termSize.rows,
    cwd: workspace(),
    env,
  });
  term.onData((data) => win?.webContents.send("pty:data", data));
  term.onExit(({ exitCode }) => {
    term = null;
    if (command !== "claude" || restarting) {
      restarting = false;
      return startClaude();
    }
    win?.webContents.send("pty:exit", { notFound: exitCode === 127 });
  });

  if (pending) {
    const text = pending;
    pending = null;
    // Give Claude Code a moment to draw its prompt before typing into it.
    setTimeout(() => term?.write(text), 2500);
  }
}

function restartClaude() {
  win?.webContents.send("pty:clear");
  if (!term) return startClaude();
  restarting = true;
  term.kill();
}

function askClaude(text) {
  if (!panelOpen) setPanel(true);
  win?.webContents.send("panel:focus");
  if (term) term.write(text);
  else {
    pending = text;
    startClaude();
  }
}

ipcMain.on("pty:ready", (_e, size) => {
  termSize = size;
  startClaude();
});
ipcMain.on("pty:input", (_e, data) => term?.write(data));
ipcMain.on("pty:resize", (_e, size) => {
  termSize = size;
  try {
    term?.resize(size.cols, size.rows);
  } catch {}
});
ipcMain.on("pty:restart", () => startClaude());
ipcMain.on("pty:install", () => startClaude(INSTALL_COMMAND));

ipcMain.on("panel:toggle", () => setPanel(!panelOpen));
ipcMain.on("panel:width", (_e, width) => {
  panelWidth = clampWidth(width);
  layout();
});
ipcMain.on("panel:width-done", () => saveSettings());

ipcMain.on("site:back", () => site?.webContents.navigationHistory.goBack());
ipcMain.on("site:forward", () => site?.webContents.navigationHistory.goForward());
ipcMain.on("site:context", (_e, item) => {
  lastContext = { item, at: Date.now() };
});
ipcMain.on("site:ask", (_e, item) => askClaude(aboutItem(item)));

// ---------- Menus ----------

function buildMenu() {
  const template = [
    { role: "appMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Claude Panel", accelerator: "CmdOrCtrl+J", click: () => setPanel(!panelOpen) },
        { label: "Restart Claude", click: restartClaude },
        { type: "separator" },
        { label: "Back", accelerator: "CmdOrCtrl+[", click: () => site?.webContents.navigationHistory.goBack() },
        { label: "Forward", accelerator: "CmdOrCtrl+]", click: () => site?.webContents.navigationHistory.goForward() },
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => site?.webContents.reload() },
        { type: "separator" },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: () => site?.webContents.setZoomLevel(0) },
        { label: "Zoom In", accelerator: "CmdOrCtrl+=", click: () => zoom(0.5) },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => zoom(-0.5) },
        { type: "separator" },
        { role: "togglefullscreen" },
        { label: "Developer Tools", accelerator: "Alt+CmdOrCtrl+I", click: () => site?.webContents.toggleDevTools() },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function zoom(step) {
  if (site) site.webContents.setZoomLevel(site.webContents.getZoomLevel() + step);
}

app.setName("LukeOS");
app.whenReady().then(() => {
  loadSettings();
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (!win) createWindow();
  });
});

app.on("window-all-closed", () => {
  term?.kill();
  term = null;
  app.quit();
});
