const { getAlmanac, formatActivities } = require("./lib/almanac");
const { clothingTip, outdoorAdvice } = require("./lib/clothing");
const {
  formatHumidity,
  formatTemperature,
  formatUv,
  weatherLabel,
} = require("./lib/weather");

let currentLocation = null;
let requestSerial = 0;
let searchOpen = false;
let settingsOpen = false;
let composing = false;

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

function renderLocation(location) {
  document.getElementById("place-name").textContent = location ? location.name : "未选择地点";
  document.getElementById("place-detail").textContent = location && location.detail ? location.detail : "";
}

function showWeatherEmpty(message) {
  document.getElementById("weather-empty").hidden = false;
  document.getElementById("weather-empty").textContent = message;
  document.getElementById("weather-skeleton").hidden = true;
  document.getElementById("weather-data").hidden = true;
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
  document.getElementById("condition").textContent = weatherLabel(weather.weatherCode);
  document.getElementById("humidity").textContent = `湿度 ${formatHumidity(weather.humidity)}`;
  document.getElementById("uv").textContent = `紫外线 ${formatUv(weather.uvIndex)}`;
  const tip = clothingTip(weather);
  const clothing = document.getElementById("clothing");
  clothing.hidden = !tip;
  clothing.textContent = tip || "";
  document.getElementById("outdoor").textContent = outdoorAdvice(weather.uvIndex);
  document.getElementById("stale-tag").hidden = !stale;
}

function openSearch() {
  if (settingsOpen) closeSettings();
  if (searchOpen) {
    closeSearch();
    return;
  }
  searchOpen = true;
  const surface = document.getElementById("search-surface");
  const input = document.getElementById("search-input");
  surface.inert = false;
  surface.classList.add("is-open");
  surface.setAttribute("aria-hidden", "false");
  document.getElementById("search-toggle").setAttribute("aria-expanded", "true");
  input.setAttribute("aria-expanded", "true");
  input.focus();
  input.select();
}

function openSettings() {
  if (searchOpen) closeSearch();
  if (settingsOpen) {
    closeSettings();
    return;
  }
  settingsOpen = true;
  const surface = document.getElementById("settings-surface");
  const input = document.getElementById("amap-key-input");
  surface.inert = false;
  surface.classList.add("is-open");
  surface.setAttribute("aria-hidden", "false");
  document.getElementById("settings-toggle").setAttribute("aria-expanded", "true");
  document.getElementById("settings-message").textContent = "";
  input.focus();
  input.select();
  if (!window.widget || typeof window.widget.getSettings !== "function") return;
  window.widget.getSettings().then((settings) => {
    if (!settingsOpen) return;
    input.value = settings && typeof settings.amapKey === "string" ? settings.amapKey : "";
  }).catch(() => {
    if (settingsOpen) document.getElementById("settings-message").textContent = "没有读到已保存的 Key";
  });
}

function closeSettings() {
  if (!settingsOpen) return;
  settingsOpen = false;
  const surface = document.getElementById("settings-surface");
  surface.classList.remove("is-open");
  surface.setAttribute("aria-hidden", "true");
  document.getElementById("settings-toggle").setAttribute("aria-expanded", "false");
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

function closeSearch() {
  if (!searchOpen) return;
  searchOpen = false;
  const surface = document.getElementById("search-surface");
  const input = document.getElementById("search-input");
  surface.classList.remove("is-open");
  surface.setAttribute("aria-hidden", "true");
  document.getElementById("search-toggle").setAttribute("aria-expanded", "false");
  input.setAttribute("aria-expanded", "false");
  document.getElementById("search-toggle").focus();
  surface.inert = true;
}

function clearResults() {
  document.getElementById("search-results").replaceChildren();
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
  closeSearch();
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
  } catch {
    clearResults();
    message.textContent = "搜索失败";
  } finally {
    button.disabled = false;
  }
}

function bindUi() {
  const input = document.getElementById("search-input");
  const surface = document.getElementById("search-surface");
  document.getElementById("search-toggle").addEventListener("click", openSearch);
  document.getElementById("settings-toggle").addEventListener("click", openSettings);
  document.getElementById("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    saveAmapKey(document.getElementById("amap-key-input").value);
  });
  document.getElementById("settings-clear").addEventListener("click", () => {
    document.getElementById("amap-key-input").value = "";
    saveAmapKey("");
  });
  document.getElementById("settings-surface").addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeSettings();
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
      closeSearch();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!document.querySelector("#search-results .result-item")) return;
      event.preventDefault();
      moveResultFocus(event.key === "ArrowDown" ? 1 : -1);
    }
  });
  surface.addEventListener("focusin", (event) => {
    for (const item of document.querySelectorAll("#search-results .result-item")) {
      item.setAttribute("aria-selected", item === event.target ? "true" : "false");
    }
  });
  document.querySelector(".body").addEventListener("pointerdown", (event) => {
    if (searchOpen && !event.target.closest("#search-surface")) closeSearch();
    if (settingsOpen && !event.target.closest("#settings-surface")) closeSettings();
  });
}

async function boot() {
  renderAlmanac(new Date());
  setInterval(() => renderAlmanac(new Date()), 60 * 1000);
  bindUi();
  try {
    if (!window.widget) return;
    const state = await window.widget.getState();
    if (state.location) {
      currentLocation = state.location;
      renderLocation(state.location);
      if (state.weather) renderWeather(state.weather, { stale: false });
      else showSkeleton();
      await refreshWeather(state.location);
    }
  } finally {
    document.body.dataset.ready = "1";
  }
  setInterval(() => {
    if (currentLocation) refreshWeather(currentLocation);
  }, 30 * 60 * 1000);
}

boot();
