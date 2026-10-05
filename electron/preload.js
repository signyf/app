const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("widget", {
  getState: () => ipcRenderer.invoke("state:get"),
  saveLocation: (location) => ipcRenderer.invoke("location:save", location),
  searchPlaces: (query) => ipcRenderer.invoke("places:search", query),
  getWeather: (location) => ipcRenderer.invoke("weather:get", location),
  close: () => ipcRenderer.invoke("window:close"),
});
