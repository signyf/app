const { getAlmanac, formatActivities } = require("./lib/almanac");
const { clothingTip, outdoorAdvice, humidityAdvice } = require("./lib/clothing");
const {
  formatHumidity,
  formatTemperature,
  formatUv,
  weatherLabel,
  weatherMark,
} = require("./lib/weather");
const { markForAmapWeather } = require("./lib/amap-weather");

let currentLocation = null;
let requestSerial = 0;
let settingsOpen = false;
let composing = false;
let glassSaveTimer = null;

function renderAlmanac(date) {
  const almanac = getAlmanac(date.getFullYear(), date.getMonth() + 1, date.getDate());
  document.getElementById("gregorian").textContent = almanac.gregorian;
  document.getElementById("lunar").textContent = almanac.lunar;
  document.getElementById("yi").textContent = formatActivities(almanac.yi);
  document.getElementById("ji").textContent = formatActivities(almanac.ji);
  const festivals = document.getElementById("festivals");
  if (almanac.festivals.length) {
    festivals.textContent = almanac.festivals.join("、");
    festivals.classList.add("has-day");
  } else {
    festivals.textContent = "今日无节庆";
    festivals.classList.remove("has-day");
  }
}

function applyGlass(percent) {
  const number = Math.round(Number(percent));
  const safe = Number.isFinite(number) ? Math.min(100, Math.max(40, number)) : 70;
  document.documentElement.style.setProperty("--glass", String(safe / 100));
  const range = document.getElementById("opacity-range");
  const label = document.getElementById("opacity-value");
  if (range) {
    range.value = String(safe);
    range.setAttribute("aria-valuenow", String(safe));
  }
  if (label) label.textContent = `${safe}%`;
  return safe;
}

function queueGlassSave(percent) {
  const safe = applyGlass(percent);
  clearTimeout(glassSaveTimer);
  glassSaveTimer = setTimeout(() => {
    if (!window.widget || typeof window.widget.saveSettings !== "function") return;
    window.widget.saveSettings({ glassOpacity: safe }).catch(() => {
      const message = document.getElementById("settings-message");
      if (message) message.textContent = "保存失败";
    });
  }, 120);
}

function renderLocation(location) {
  const chosen = Boolean(location);
  const selected = document.getElementById("selected-place");
  const name = document.getElementById("selected-place-name");
  const detail = document.getElementById("selected-place-detail");
  if (!chosen) {
    selected.hidden = true;
    name.textContent = "";
    detail.textContent = "";
    return;
  }
  name.textContent = location.name;
  detail.textContent = location.detail && location.detail !== location.name ? location.detail : "";
  selected.hidden = false;
}

function showWeatherEmpty(message) {
  document.getElementById("weather-empty").hidden = false;
  document.getElementById("weather-empty").textContent = message;
  document.getElementById("weather-skeleton").hidden = true;
  document.getElementById("weather-data").hidden = true;
}

function skyLabel(weather) {
  if (weather && weather.source === "amap" && weather.condition) return weather.condition;
  return weatherLabel(weather && weather.weatherCode);
}

function showSkeleton() {
  document.getElementById("weather-empty").hidden = true;
  document.getElementById("weather-skeleton").hidden = false;
  document.getElementById("weather-data").hidden = true;
}

function setStatus(message, warn) {
  const status = document.getElementById("status");
  status.textContent = message || "";
  status.classList.toggle("warn", Boolean(warn) && Boolean(message));
}

function renderWeather(weather, { stale = false } = {}) {
  if (!weather) {
    showWeatherEmpty("选择地点");
    return;
  }
  document.getElementById("weather-empty").hidden = true;
  document.getElementById("weather-skeleton").hidden = true;
  document.getElementById("weather-data").hidden = false;
  document.getElementById("temp-value").textContent = formatTemperature(weather.temperature);
  document.getElementById("condition").textContent = skyLabel(weather);
  document.getElementById("humidity").textContent = `湿度 ${formatHumidity(weather.humidity)}`;
  document.getElementById("uv").textContent = `紫外线 ${formatUv(weather.uvIndex)}`;
  const tip = clothingTip(weather);
  const clothing = document.getElementById("clothing");
  clothing.hidden = !tip;
  clothing.textContent = tip || "";
  document.getElementById("outdoor").textContent = outdoorAdvice(weather.uvIndex);
  document.getElementById("humidity-advice").textContent = humidityAdvice(weather.humidity);
  const shown = formatTemperature(weather.temperature);
  document.getElementById("ball-temp").textContent = shown === "--" ? "--" : `${shown}°`;
  document.getElementById("ball-mark").dataset.mark = weather.source === "amap"
    ? markForAmapWeather(weather.condition)
    : weatherMark(weather.weatherCode);
  document.getElementById("stale-tag").hidden = !stale;
}

function openSettings() {
  if (settingsOpen) {
    closeSettings();
    return;
  }
  settingsOpen = true;
  document.documentElement.dataset.settings = "open";
  const surface = document.getElementById("settings-surface");
  const input = document.getElementById("search-input");
  surface.inert = false;
  surface.classList.add("is-open");
  surface.setAttribute("aria-hidden", "false");
  document.getElementById("settings-toggle").setAttribute("aria-expanded", "true");
  document.getElementById("settings-message").textContent = "";
  input.focus();
  if (!window.widget || typeof window.widget.getSettings !== "function") return;
  window.widget.getSettings().then((settings) => {
    if (!settingsOpen) return;
    document.getElementById("amap-key-input").value = settings && typeof settings.amapKey === "string" ? settings.amapKey : "";
    document.getElementById("launch-toggle").checked = Boolean(settings && settings.launchAtLogin);
    applyGlass(settings && settings.glassOpacity);
  }).catch(() => {
    if (settingsOpen) document.getElementById("settings-message").textContent = "没有读到已保存的 Key";
  });
}

function closeSettings() {
  if (!settingsOpen) return;
  settingsOpen = false;
  delete document.documentElement.dataset.settings;
  const surface = document.getElementById("settings-surface");
  surface.classList.remove("is-open");
  surface.setAttribute("aria-hidden", "true");
  document.getElementById("settings-toggle").setAttribute("aria-expanded", "false");
  document.getElementById("search-input").setAttribute("aria-expanded", "false");
  document.getElementById("settings-toggle").focus();
  surface.inert = true;
}

async function saveAmapKey(value) {
  const message = document.getElementById("settings-message");
  if (!window.widget || typeof window.widget.saveSettings !== "function") {
    message.textContent = "保存失败";
    return;
  }
  try {
    const response = await window.widget.saveSettings({ amapKey: value });
    if (!response || response.ok !== true) {
      message.textContent = "保存失败";
      return;
    }
    document.getElementById("amap-key-input").value = typeof response.amapKey === "string" ? response.amapKey : "";
    message.textContent = response.amapKey ? "已保存" : "已清除";
  } catch {
    message.textContent = "保存失败";
  }
}

function clearResults() {
  document.getElementById("search-results").replaceChildren();
  document.getElementById("search-input").setAttribute("aria-expanded", "false");
}

function showSearchSkeleton() {
  const list = document.getElementById("search-results");
  list.replaceChildren();
  for (let index = 0; index < 3; index += 1) {
    const row = document.createElement("div");
    row.className = "sk sk-result";
    list.append(row);
  }
}

function renderResults(places) {
  const list = document.getElementById("search-results");
  list.replaceChildren();
  places.forEach((place, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result-item";
    button.id = `place-option-${index}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    const name = document.createElement("span");
    name.className = "result-name";
    name.textContent = place.name;
    const detail = document.createElement("span");
    detail.className = "result-detail";
    detail.textContent = place.detail;
    button.append(name, detail);
    button.addEventListener("click", () => {
      choosePlace(place);
    });
    list.append(button);
  });
}

function moveResultFocus(delta) {
  const items = [...document.querySelectorAll("#search-results .result-item")];
  if (!items.length) return;
  const current = items.indexOf(document.activeElement);
  if (current === -1) {
    items[delta > 0 ? 0 : items.length - 1].focus();
    return;
  }
  const next = current + delta;
  if (next < 0) {
    document.getElementById("search-input").focus();
    return;
  }
  items[next % items.length].focus();
}

async function refreshWeather(location) {
  const id = ++requestSerial;
  const showingData = !document.getElementById("weather-data").hidden;
  if (!showingData) showSkeleton();
  try {
    const result = await window.widget.getWeather(location);
    if (id !== requestSerial) return;
    if (result.weather) {
      renderWeather(result.weather, { stale: Boolean(result.stale) });
      setStatus(result.message, Boolean(result.stale));
      return;
    }
    showWeatherEmpty("获取失败");
    setStatus(result.message || "获取失败", true);
  } catch {
    if (id !== requestSerial) return;
    showWeatherEmpty("获取失败");
    setStatus("获取失败", true);
  }
}

async function choosePlace(place) {
  clearResults();
  const saved = await window.widget.saveLocation(place);
  if (!saved || !saved.ok) {
    showWeatherEmpty("获取失败");
    setStatus("获取失败", true);
    return;
  }
  currentLocation = saved.location;
  renderLocation(currentLocation);
  if (saved.weather) renderWeather(saved.weather, { stale: false });
  else showSkeleton();
  await refreshWeather(currentLocation);
}

async function runSearch(query) {
  const message = document.getElementById("search-message");
  const button = document.getElementById("search-button");
  message.textContent = "";
  if (!query) {
    clearResults();
    message.textContent = "没有结果";
    return;
  }
  if (!window.widget || typeof window.widget.searchPlaces !== "function") {
    clearResults();
    message.textContent = "搜索失败";
    return;
  }
  button.disabled = true;
  showSearchSkeleton();
  try {
    const response = await window.widget.searchPlaces(query);
    if (!response || response.ok !== true) {
      clearResults();
      message.textContent = (response && response.message) || "搜索失败";
      return;
    }
    if (!Array.isArray(response.places) || !response.places.length) {
      clearResults();
      message.textContent = "没有结果";
      return;
    }
    message.textContent = "";
    renderResults(response.places);
    document.getElementById("search-input").setAttribute("aria-expanded", "true");
  } catch {
    clearResults();
    message.textContent = "搜索失败";
  } finally {
    button.disabled = false;
  }
}

function bindUi() {
  const input = document.getElementById("search-input");
  const surface = document.getElementById("settings-surface");
  document.getElementById("settings-toggle").addEventListener("click", openSettings);
  document.getElementById("opacity-range").addEventListener("input", (event) => {
    queueGlassSave(event.target.value);
  });
  document.getElementById("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    saveAmapKey(document.getElementById("amap-key-input").value);
  });
  document.getElementById("settings-clear").addEventListener("click", () => {
    document.getElementById("amap-key-input").value = "";
    saveAmapKey("");
  });
  document.getElementById("launch-toggle").addEventListener("change", async (event) => {
    if (!window.widget || typeof window.widget.saveSettings !== "function") return;
    try {
      const response = await window.widget.saveSettings({ launchAtLogin: event.target.checked });
      if (!response || response.ok !== true) throw new Error("save failed");
    } catch {
      event.target.checked = !event.target.checked;
      document.getElementById("settings-message").textContent = "保存失败";
    }
  });
  const ball = document.getElementById("edge-ball");
  let ballDrag = false;
  let ballMoved = false;
  let ballStart = null;
  ball.addEventListener("pointerdown", (event) => {
    ballDrag = true;
    ballMoved = false;
    ballStart = { x: event.screenX, y: event.screenY };
    ball.setPointerCapture(event.pointerId);
  });
  ball.addEventListener("pointermove", (event) => {
    if (!ballDrag || !ballStart || !window.widget || !window.widget.moveBall) return;
    if (Math.hypot(event.screenX - ballStart.x, event.screenY - ballStart.y) < 5) return;
    ballMoved = true;
    window.widget.moveBall(event.screenX, event.screenY);
  });
  ball.addEventListener("pointerup", () => {
    const moved = ballMoved;
    ballDrag = false;
    ballMoved = false;
    ballStart = null;
    if (!moved && window.widget && window.widget.expandDock) window.widget.expandDock();
  });
  window.addEventListener("pointerenter", () => {
    if (ballDrag || !window.widget || !window.widget.dockPointer) return;
    window.widget.dockPointer(true);
  });
  window.addEventListener("pointerleave", () => {
    if (ballDrag || !window.widget || !window.widget.dockPointer) return;
    window.widget.dockPointer(false);
  });
  document.getElementById("close-button").addEventListener("click", () => {
    if (window.widget) window.widget.close();
  });
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
  });
  document.getElementById("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (composing || event.isComposing) return;
    runSearch(input.value.trim());
  });
  surface.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSettings();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const inSearch = event.target === input || event.target.classList.contains("result-item");
    if (!inSearch || !document.querySelector("#search-results .result-item")) return;
    event.preventDefault();
    moveResultFocus(event.key === "ArrowDown" ? 1 : -1);
  });
  surface.addEventListener("focusin", (event) => {
    for (const item of document.querySelectorAll("#search-results .result-item")) {
      item.setAttribute("aria-selected", item === event.target ? "true" : "false");
    }
  });
  document.querySelector(".body").addEventListener("pointerdown", (event) => {
    if (settingsOpen && !event.target.closest("#settings-surface") && !event.target.closest("#settings-toggle")) {
      closeSettings();
    }
  });
}

function applyDockMode(state) {
  const root = document.documentElement;
  root.dataset.dock = state && state.ball ? "ball" : "panel";
  root.dataset.edge = state && state.edge ? state.edge : "";
  root.dataset.tuck = state && state.tucked ? "1" : "0";
  if (state && Number.isFinite(state.ballSize) && Number.isFinite(state.ballPeek)) {
    root.style.setProperty("--ball", `${state.ballSize}px`);
    root.style.setProperty("--peek", `${state.ballPeek}px`);
  }
}

async function boot() {
  renderAlmanac(new Date());
  setInterval(() => renderAlmanac(new Date()), 60 * 1000);
  bindUi();
  try {
    if (!window.widget) return;
    if (window.widget.onDockMode) window.widget.onDockMode(applyDockMode);
    if (window.widget.dockState) applyDockMode(await window.widget.dockState());
    else document.documentElement.dataset.dock = "panel";
    if (window.widget.getSettings) {
      const settings = await window.widget.getSettings();
      applyGlass(settings && settings.glassOpacity);
    }
    const state = await window.widget.getState();
    renderLocation(state.location || null);
    if (state.location) {
      currentLocation = state.location;
      if (state.weather) renderWeather(state.weather, { stale: false });
      else showSkeleton();
      await refreshWeather(state.location);
    }
  } finally {
    if (!document.documentElement.dataset.dock) document.documentElement.dataset.dock = "panel";
    document.body.dataset.ready = "1";
  }
  setInterval(() => {
    if (currentLocation) refreshWeather(currentLocation);
  }, 30 * 60 * 1000);
}

boot();
