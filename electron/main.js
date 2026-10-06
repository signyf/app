const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, Menu, dialog, ipcMain, screen, session, nativeTheme } = require("electron");

const { createStore, normalizeLocation } = require("./state");
const { initialPosition } = require("./placement");
const { importLegacyKey, normalizeAmapKey, readSettings, writeSettings } = require("./settings");
const { searchPlaces } = require("../src/lib/geocode");
const { fetchWeatherPayload, resolveWeatherView, samePlace } = require("../src/lib/weather");

const USER_AGENT = "tianqi-widget/1.6 (desktop weather widget)";

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

function showStartupError(error) {
  const detail = error && error.stack ? String(error.stack) : String(error);
  console.error(detail);
  try {
    dialog.showErrorBox("天气小挂件无法启动", detail);
  } catch (dialogError) {
    console.error(dialogError && dialogError.message ? dialogError.message : dialogError);
  }
}

function settingsFile() {
  return path.join(app.getPath("userData"), "widget-settings.json");
}

function readLegacyAmapText() {
  const resources = typeof process.resourcesPath === "string" ? process.resourcesPath : "";
  const files = [
    resources && path.join(resources, "amap.key"),
    path.join(process.cwd(), "amap.key"),
    path.join(path.dirname(process.execPath), "amap.key"),
    path.join(app.getPath("userData"), "amap.key"),
  ].filter(Boolean);
  for (const file of files) {
    try {
      const text = fs.readFileSync(file, "utf8");
      if (normalizeAmapKey(text)) return text;
    } catch {
      // An old key file is optional and is never required.
    }
  }
  return "";
}

function ensureSettings() {
  const file = settingsFile();
  let settings = readSettings(file);
  if (!settings.legacyChecked) {
    settings = writeSettings(file, importLegacyKey(settings, readLegacyAmapText()));
  }
  return settings;
}

function currentAmapKey() {
  try {
    return ensureSettings().amapKey;
  } catch (error) {
    console.error(error && error.message ? error.message : "无法读取高德 Key 设置");
    return "";
  }
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
        amapKey: currentAmapKey(),
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

  ipcMain.handle("settings:get", () => {
    const settings = ensureSettings();
    return { amapKey: settings.amapKey };
  });

  ipcMain.handle("settings:save", (_event, payload) => {
    const amapKey = normalizeAmapKey(payload && payload.amapKey);
    const saved = writeSettings(settingsFile(), { amapKey, legacyChecked: true });
    return { ok: true, amapKey: saved.amapKey };
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

function windowOptions(store, mica) {
  const saved = store.load();
  const position = initialPosition(saved.window, screen.getAllDisplays());
  const options = {
    width: 360,
    height: 452,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: true,
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
  return options;
}

function createWindow(store) {
  let win;
  try {
    win = new BrowserWindow(windowOptions(store, process.platform === "win32"));
  } catch (error) {
    console.error(error && error.message ? error.message : error);
    win = new BrowserWindow(windowOptions(store, false));
  }
  win.removeMenu();
  attachPositionPersistence(win, store);
  const showWindow = () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  };
  win.once("ready-to-show", () => {
    showWindow();
    if (process.env.WIDGET_CAPTURE) {
      captureWhenReady(win, process.env.WIDGET_CAPTURE).catch((error) => {
        showStartupError(error);
        app.exit(1);
      });
    }
  });
  win.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    showWindow();
    showStartupError(new Error(`页面没有载入 (${code}) ${description}`));
  });
  win.loadFile(path.join(__dirname, "../src/index.html"));
  showWindow();
  return win;
}

function applyRequestedTheme() {
  const theme = process.env.WIDGET_THEME;
  if (theme === "light" || theme === "dark") nativeTheme.themeSource = theme;
}

process.on("uncaughtException", (error) => {
  showStartupError(error);
  if (!BrowserWindow.getAllWindows().length) app.quit();
});

app.whenReady().then(() => {
  try {
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
  } catch (error) {
    showStartupError(error);
  }
}).catch((error) => {
  showStartupError(error);
});

app.on("window-all-closed", () => {
  app.quit();
});
