const { contextBridge, ipcRenderer } = require("electron");

try {
  if (document.documentElement) {
    document.documentElement.dataset.material = process.platform === "win32" ? "mica" : "solid";
  }
} catch {
  // The page background still follows the window material if this runs too early.
}

contextBridge.exposeInMainWorld("widget", {
  getState: () => ipcRenderer.invoke("state:get"),
  saveLocation: (location) => ipcRenderer.invoke("location:save", location),
  searchPlaces: (query) => ipcRenderer.invoke("places:search", query),
  getWeather: (location) => ipcRenderer.invoke("weather:get", location),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  dockState: () => ipcRenderer.invoke("dock:state"),
  dockPointer: (inside) => ipcRenderer.invoke("dock:pointer", inside),
  expandDock: () => ipcRenderer.invoke("dock:open"),
  slideDock: () => ipcRenderer.invoke("dock:slide"),
  collapseDock: () => ipcRenderer.invoke("dock:collapse"),
  moveBall: (x, y) => ipcRenderer.invoke("dock:move", { x, y }),
  onDockMode: (callback) => {
    ipcRenderer.on("dock:mode", (_event, state) => callback(state));
  },
  close: () => ipcRenderer.invoke("window:close"),
});
