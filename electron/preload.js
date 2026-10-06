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
  close: () => ipcRenderer.invoke("window:close"),
});
