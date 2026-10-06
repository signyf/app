const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("widget", {
  getState: () => ipcRenderer.invoke("state:get"),
  saveLocation: (location) => ipcRenderer.invoke("location:save", location),
  searchPlaces: (query) => ipcRenderer.invoke("places:search", query),
  getWeather: (location) => ipcRenderer.invoke("weather:get", location),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  setGlassOpacity: (percent) => ipcRenderer.invoke("window:glass", percent),
  fitPanel: (height) => ipcRenderer.invoke("window:fit", height),
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
