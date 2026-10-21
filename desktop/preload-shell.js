// The app's own chrome: the top bar and the Claude panel.

const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (fn) => ipcRenderer.on(channel, (_e, value) => fn(value));

contextBridge.exposeInMainWorld("shell", {
  ptyReady: (size) => ipcRenderer.send("pty:ready", size),
  ptyInput: (data) => ipcRenderer.send("pty:input", data),
  ptyResize: (size) => ipcRenderer.send("pty:resize", size),
  ptyRestart: () => ipcRenderer.send("pty:restart"),
  ptyInstall: () => ipcRenderer.send("pty:install"),
  onPtyData: on("pty:data"),
  onPtyExit: on("pty:exit"),
  onPtyClear: on("pty:clear"),

  togglePanel: () => ipcRenderer.send("panel:toggle"),
  setPanelWidth: (width) => ipcRenderer.send("panel:width", width),
  panelWidthDone: () => ipcRenderer.send("panel:width-done"),
  onPanelState: on("panel:state"),
  onPanelFocus: on("panel:focus"),

  back: () => ipcRenderer.send("site:back"),
  forward: () => ipcRenderer.send("site:forward"),
  onSiteNav: on("site:nav"),
});
