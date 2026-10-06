const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, Menu, dialog, ipcMain, screen, session, nativeTheme } = require("electron");

const { createStore, normalizeLocation } = require("./state");
const { initialPosition } = require("./placement");
const { importLegacyKey, normalizeAmapKey, normalizeGlassOpacity, glassBackgroundColor, readSettings, writeSettings } = require("./settings");
const { loginItemSettings, loginTarget, shouldApplyLoginItem } = require("./launch");
const { PANEL_WIDTH, getPanelHeight, setPanelHeight, displayForBounds, createDockSession } = require("./dock");
const { searchPlaces } = require("../src/lib/geocode");
const { describeWeatherStatus, loadPlaceWeather, resolveWeatherView, samePlace } = require("../src/lib/weather");

const USER_AGENT = "tianqi-widget/1.12 (desktop weather widget)";

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

function applyLaunchAtLogin(enabled) {
  if (!shouldApplyLoginItem(process.platform)) return;
  try {
    const target = loginTarget(process.env, process.execPath);
    app.setLoginItemSettings(loginItemSettings(enabled === true, target));
  } catch (error) {
    console.error(error && error.message ? error.message : "开机启动设置失败");
  }
}

function paintGlass(ball, percent) {
  const value = percent === undefined ? ensureSettings().glassOpacity : percent;
  const color = ball ? "#00000000" : glassBackgroundColor(value);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setBackgroundColor(color);
  }
  return color;
}

function registerIpc(store, dock) {
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
    const now = new Date().toISOString();
    try {
      const loaded = await loadPlaceWeather(requested, {
        amapKey: currentAmapKey(),
        now,
      });
      const view = {
        ok: true,
        stale: false,
        weather: loaded.weather,
        message: describeWeatherStatus({
          ok: true,
          stale: false,
          fetchedAt: now,
        }),
      };
      store.update((current) => {
        if (!current.location || !samePlace(current.location, requested)) return current;
        const adcode = loaded.adcode || current.location.adcode || "";
        return {
          ...current,
          location: adcode ? { ...current.location, adcode } : current.location,
          weather: view.weather,
        };
      });
      return view;
    } catch {
      return resolveWeatherView({
        requested,
        cachedLocation: before.location,
        cachedWeather: before.weather,
        payload: null,
        error: true,
        now,
      });
    }
  });

  ipcMain.handle("window:close", () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) win.close();
  });

  ipcMain.handle("settings:get", () => {
    const settings = ensureSettings();
    return {
      amapKey: settings.amapKey,
      launchAtLogin: settings.launchAtLogin === true,
      glassOpacity: settings.glassOpacity,
    };
  });

  ipcMain.handle("settings:save", (_event, payload) => {
    const current = ensureSettings();
    const hasKey = Boolean(payload) && Object.prototype.hasOwnProperty.call(payload, "amapKey");
    const amapKey = hasKey ? normalizeAmapKey(payload.amapKey) : current.amapKey;
    const launchAtLogin = payload && typeof payload.launchAtLogin === "boolean"
      ? payload.launchAtLogin
      : current.launchAtLogin === true;
    const glassOpacity = payload && Object.prototype.hasOwnProperty.call(payload, "glassOpacity")
      ? normalizeGlassOpacity(payload.glassOpacity)
      : normalizeGlassOpacity(current.glassOpacity);
    const saved = writeSettings(settingsFile(), { amapKey, legacyChecked: true, launchAtLogin, glassOpacity });
    applyLaunchAtLogin(saved.launchAtLogin);
    paintGlass();
    return {
      ok: true,
      amapKey: saved.amapKey,
      launchAtLogin: saved.launchAtLogin,
      glassOpacity: saved.glassOpacity,
    };
  });

  ipcMain.handle("window:glass", (_event, percent) => {
    paintGlass(false, percent);
    return glassBackgroundColor(percent);
  });

  ipcMain.handle("window:fit", (_event, height) => {
    const next = setPanelHeight(height);
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed() || dock.isBall()) return next;
    const bounds = win.getBounds();
    if (bounds.height !== next) {
      if (dock.holdMoves) dock.holdMoves();
      win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: next });
    }
    return next;
  });

  ipcMain.handle("dock:state", () => dock.view());
  ipcMain.handle("dock:pointer", (_event, inside) => dock.pointer(Boolean(inside)));
  ipcMain.handle("dock:open", () => dock.open());
  ipcMain.handle("dock:slide", () => dock.slide());
  ipcMain.handle("dock:collapse", () => dock.collapse());
  ipcMain.handle("dock:move", (_event, point) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return dock.view();
    return dock.move(point);
  });
}

function createDockBinding() {
  const session = createDockSession();
  let win = null;
  let store = null;
  let ignoreMoves = 0;
  let snapTimer = null;
  let hoverTimer = null;
  let leaveTimer = null;
  let persistTimer = null;

  function currentDisplay(bounds) {
    const displays = screen.getAllDisplays();
    return displayForBounds(bounds, displays) || displays[0] || null;
  }

  function remember() {
    if (!store || !win || win.isDestroyed()) return;
    const bounds = win.getBounds();
    const view = session.view();
    store.update((current) => ({
      ...current,
      window: {
        x: bounds.x,
        y: bounds.y,
        edge: view.edge,
        anchor: Number.isFinite(view.anchor) ? Math.round(view.anchor) : null,
      },
    }));
  }

  function publish() {
    const view = session.view();
    if (win && !win.isDestroyed()) {
      paintGlass(view.ball);
      const display = currentDisplay(win.getBounds());
      const next = session.place(display);
      if (next) {
        const current = win.getBounds();
        const same = current.x === next.x
          && current.y === next.y
          && current.width === next.width
          && current.height === next.height;
        if (!same) {
          ignoreMoves += 1;
          win.setBounds(next);
          setTimeout(() => {
            ignoreMoves = Math.max(0, ignoreMoves - 1);
          }, 300);
        }
      }
      if (!win.webContents.isLoading()) win.webContents.send("dock:mode", view);
    }
    clearTimeout(persistTimer);
    persistTimer = setTimeout(remember, 200);
    return view;
  }

  return {
    view() {
      return session.view();
    },
    isBall() {
      return session.view().ball;
    },
    holdMoves() {
      ignoreMoves += 1;
      setTimeout(() => {
        ignoreMoves = Math.max(0, ignoreMoves - 1);
      }, 300);
    },
    startupBounds(saved) {
      const display = saved
        ? currentDisplay({ x: saved.x, y: saved.y, width: PANEL_WIDTH, height: getPanelHeight() })
        : screen.getAllDisplays()[0] || null;
      session.restore(saved, display);
      return session.place(display);
    },
    attach(nextWindow, nextStore) {
      win = nextWindow;
      store = nextStore;
      const snapReleased = () => {
        if (!win || win.isDestroyed() || ignoreMoves > 0) return;
        const bounds = win.getBounds();
        let pointer = null;
        try {
          pointer = screen.getCursorScreenPoint();
        } catch {
          pointer = null;
        }
        session.snap(bounds, currentDisplay(bounds), pointer);
        publish();
      };
      win.on("move", () => {
        if (ignoreMoves > 0) return;
        clearTimeout(snapTimer);
        snapTimer = setTimeout(snapReleased, 280);
      });
      win.on("moved", () => {
        if (ignoreMoves > 0) return;
        clearTimeout(snapTimer);
        snapReleased();
      });
      win.on("close", () => {
        clearTimeout(snapTimer);
        clearTimeout(hoverTimer);
        clearTimeout(leaveTimer);
        clearTimeout(persistTimer);
        remember();
      });
      const send = () => {
        if (!win.isDestroyed()) win.webContents.send("dock:mode", session.view());
      };
      if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
      else send();
    },
    view() {
      return session.view();
    },
    pointer(inside) {
      clearTimeout(hoverTimer);
      clearTimeout(leaveTimer);
      if (inside) {
        if (session.view().suppressHover) return session.view();
        session.hover();
        const view = publish();
        hoverTimer = setTimeout(() => {
          session.open();
          publish();
        }, 320);
        return view;
      }
      leaveTimer = setTimeout(() => {
        session.leave();
        publish();
      }, 420);
      return session.view();
    },
    slide() {
      clearTimeout(hoverTimer);
      clearTimeout(leaveTimer);
      session.slideOut();
      return publish();
    },
    open() {
      clearTimeout(hoverTimer);
      clearTimeout(leaveTimer);
      session.slideOut();
      const view = publish();
      hoverTimer = setTimeout(() => {
        session.open();
        publish();
      }, 240);
      return view;
    },
    collapse() {
      clearTimeout(hoverTimer);
      clearTimeout(leaveTimer);
      const bounds = win && !win.isDestroyed() ? win.getBounds() : null;
      const display = bounds ? currentDisplay(bounds) : (screen.getAllDisplays()[0] || null);
      session.collapseNow(bounds, display);
      return publish();
    },
    move(point) {
      clearTimeout(hoverTimer);
      clearTimeout(leaveTimer);
      const display = currentDisplay({ x: point.x, y: point.y, width: 1, height: 1 });
      session.drag(point, display);
      return publish();
    },
  };
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

function windowOptions(store, dockBounds, ball) {
  const saved = store.load();
  const position = dockBounds ? null : initialPosition(saved.window, screen.getAllDisplays());
  const options = {
    width: dockBounds ? dockBounds.width : PANEL_WIDTH,
    height: dockBounds ? dockBounds.height : getPanelHeight(),
    frame: false,
    thickFrame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: true,
    alwaysOnTop: true,
    transparent: true,
    title: "天气小挂件",
    backgroundColor: ball ? "#00000000" : glassBackgroundColor(ensureSettings().glassOpacity),
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  if (dockBounds) {
    options.x = dockBounds.x;
    options.y = dockBounds.y;
  } else if (position && Number.isInteger(position.x) && Number.isInteger(position.y)) {
    options.x = position.x;
    options.y = position.y;
  }
  return options;
}

function createWindow(store, dock) {
  const dockBounds = dock.startupBounds(store.load().window);
  const ball = dock.isBall();
  let win;
  try {
    win = new BrowserWindow(windowOptions(store, dockBounds, ball));
  } catch (error) {
    console.error(error && error.message ? error.message : error);
    win = new BrowserWindow(windowOptions(store, dockBounds, ball));
  }
  win.removeMenu();
  dock.attach(win, store);
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
    const store = createStore(path.join(app.getPath("userData"), "widget-state.json"));
    applyLaunchAtLogin(ensureSettings().launchAtLogin);
    const dock = createDockBinding();
    registerIpc(store, dock);
    createWindow(store, dock);
  } catch (error) {
    showStartupError(error);
  }
}).catch((error) => {
  showStartupError(error);
});

app.on("window-all-closed", () => {
  app.quit();
});
