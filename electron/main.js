const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, Menu, ipcMain, screen, session, nativeTheme } = require("electron");

const { createStore, normalizeLocation } = require("./state");
const { initialPosition } = require("./placement");
const { searchPlaces } = require("../src/lib/geocode");
const { fetchWeatherPayload, resolveWeatherView, samePlace } = require("../src/lib/weather");

const USER_AGENT = "tianqi-widget/1.1 (desktop weather widget)";

function preloadPath() {
  const packed = path.join(__dirname, "preload.js");
  const marker = `${path.sep}app.asar${path.sep}`;
  const unpacked = packed.includes(marker)
    ? packed.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`)
    : packed;
  return fs.existsSync(unpacked) ? unpacked : packed;
}

function solidBackground() {
  return nativeTheme.shouldUseDarkColors ? "#202020" : "#F3F3F3";
}

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
      const places = await searchPlaces(query, {
        userAgent: USER_AGENT,
        signal: AbortSignal.timeout(12000),
      });
      if (!places.length) {
        return { ok: false, places: [], message: "没有结果" };
      }
      return { ok: true, places, message: "" };
    } catch {
      return { ok: false, places: [], message: "搜索失败" };
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
  while (Date.now() - started < 16000) {
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
  if (process.env.WIDGET_EVAL_FILE) {
    const code = fs.readFileSync(process.env.WIDGET_EVAL_FILE, "utf8");
    const result = await win.webContents.executeJavaScript(code);
    console.log("WIDGET_EVAL", result);
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await win.capturePage();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, image.toPNG());
  app.quit();
}

function createWindow(store) {
  const saved = store.load();
  const position = initialPosition(saved.window, screen.getAllDisplays());
  const mica = process.platform === "win32";
  const options = {
    width: 360,
    height: 452,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: "天气小挂件",
    backgroundColor: mica ? "#00000000" : solidBackground(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  if (mica) options.backgroundMaterial = "mica";
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
      captureWhenReady(win, process.env.WIDGET_CAPTURE).catch((error) => {
        console.error(error);
        app.exit(1);
      });
    }
  });
  win.loadFile(path.join(__dirname, "../src/index.html"));
  return win;
}

function applyRequestedTheme() {
  const theme = process.env.WIDGET_THEME;
  if (theme === "light" || theme === "dark") nativeTheme.themeSource = theme;
}

app.whenReady().then(() => {
  applyRequestedTheme();
  Menu.setApplicationMenu(null);
  session.defaultSession.setUserAgent(USER_AGENT);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  if (process.platform !== "win32") {
    nativeTheme.on("updated", () => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.setBackgroundColor(solidBackground());
      }
    });
  }
  const store = createStore(path.join(app.getPath("userData"), "widget-state.json"));
  registerIpc(store);
  createWindow(store);
});

app.on("window-all-closed", () => {
  app.quit();
});
