const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, Menu, ipcMain, screen, session } = require("electron");

const { createStore, normalizeLocation } = require("./state");
const { initialPosition } = require("./placement");
const { searchPlaces } = require("../src/lib/geocode");
const { fetchWeatherPayload, resolveWeatherView, samePlace } = require("../src/lib/weather");

const USER_AGENT = "tianqi-widget/1.0 (desktop weather widget)";

function registerIpc(store) {
  ipcMain.handle("state:get", () => {
    const state = store.load();
    return { location: state.location, weather: state.weather };
  });

  ipcMain.handle("location:save", (_event, location) => {
    const next = normalizeLocation(location);
    if (!next) return { ok: false, location: null, weather: null };
    const state = store.update((current) => {
      const keepWeather = Boolean(
        current.location && current.weather && samePlace(current.location, next),
      );
      return {
        ...current,
        location: next,
        weather: keepWeather ? current.weather : null,
      };
    });
    return { ok: true, location: state.location, weather: state.weather };
  });

  ipcMain.handle("places:search", async (_event, query) => {
    try {
      const places = await searchPlaces(query, { userAgent: USER_AGENT });
      if (!places.length) {
        return { ok: false, places: [], message: "没有找到相关地点" };
      }
      return { ok: true, places, message: "" };
    } catch {
      return { ok: false, places: [], message: "地点搜索失败" };
    }
  });

  ipcMain.handle("weather:get", async (_event, location) => {
    const requested = normalizeLocation(location);
    if (!requested) {
      return { ok: false, stale: false, weather: null, message: "天气获取失败" };
    }
    const before = store.load();
    try {
      const payload = await fetchWeatherPayload(requested.latitude, requested.longitude);
      const view = resolveWeatherView({
        requested,
        cachedLocation: before.location,
        cachedWeather: before.weather,
        payload,
        error: false,
        now: new Date().toISOString(),
      });
      if (view.ok) {
        store.update((current) => {
          if (!current.location || !samePlace(current.location, requested)) return current;
          return { ...current, weather: view.weather };
        });
      }
      return view;
    } catch {
      return resolveWeatherView({
        requested,
        cachedLocation: before.location,
        cachedWeather: before.weather,
        payload: null,
        error: true,
        now: new Date().toISOString(),
      });
    }
  });

  ipcMain.handle("window:close", () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) win.close();
  });
}

function attachPositionPersistence(win, store) {
  let moveTimer = null;
  const savePosition = () => {
    if (win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    store.update((current) => ({ ...current, window: { x, y } }));
  };
  win.on("move", () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(savePosition, 250);
  });
  win.on("close", () => {
    clearTimeout(moveTimer);
    savePosition();
  });
}

async function captureWhenReady(win, file) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const ready = await win.webContents.executeJavaScript(
        "document.body && document.body.dataset.ready || ''",
      );
      if (ready === "1") break;
    } catch {
      // The page is still loading.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  const image = await win.capturePage();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, image.toPNG());
  app.quit();
}

function createWindow(store) {
  const saved = store.load();
  const position = initialPosition(saved.window, screen.getAllDisplays());
  const options = {
    width: 360,
    height: 384,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: "天气小挂件",
    backgroundColor: "#1c2430",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  if (Number.isInteger(position.x) && Number.isInteger(position.y)) {
    options.x = position.x;
    options.y = position.y;
  }

  const win = new BrowserWindow(options);
  win.removeMenu();
  attachPositionPersistence(win, store);
  win.once("ready-to-show", () => {
    win.show();
    if (process.env.WIDGET_CAPTURE) {
      captureWhenReady(win, process.env.WIDGET_CAPTURE);
    }
  });
  win.loadFile(path.join(__dirname, "../src/index.html"));
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  const store = createStore(path.join(app.getPath("userData"), "widget-state.json"));
  registerIpc(store);
  createWindow(store);
});

app.on("window-all-closed", () => {
  app.quit();
});
