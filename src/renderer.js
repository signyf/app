const { getAlmanac, formatActivities } = require("./lib/almanac");
const { clothingTip } = require("./lib/clothing");
const {
  formatHumidity,
  formatTemperature,
  formatUv,
  weatherLabel,
} = require("./lib/weather");

let currentLocation = null;
let requestSerial = 0;

function renderAlmanac(date) {
  const almanac = getAlmanac(date.getFullYear(), date.getMonth() + 1, date.getDate());
  document.getElementById("gregorian").textContent = almanac.gregorian;
  document.getElementById("lunar").textContent = almanac.lunar;
  document.getElementById("yi").textContent = formatActivities(almanac.yi);
  document.getElementById("ji").textContent = formatActivities(almanac.ji);
  const festivals = document.getElementById("festivals");
  if (almanac.festivals.length) {
    festivals.textContent = `节日 ${almanac.festivals.join("、")}`;
    festivals.classList.remove("empty");
  } else {
    festivals.textContent = "今日无节庆";
    festivals.classList.add("empty");
  }
}

function renderLocation(location) {
  document.getElementById("place-name").textContent = location ? location.name : "未选择地点";
  document.getElementById("place-detail").textContent = location && location.detail ? location.detail : "";
}

function showWeatherEmpty(message) {
  document.getElementById("weather-empty").hidden = false;
  document.getElementById("weather-empty").textContent = message;
  document.getElementById("weather-data").hidden = true;
}

function setStatus(message, warn) {
  const status = document.getElementById("status");
  status.textContent = message || "";
  status.classList.toggle("warn", Boolean(warn) && Boolean(message));
}

function renderWeather(weather, { stale = false } = {}) {
  if (!weather) {
    showWeatherEmpty("选择地点后显示天气");
    return;
  }
  document.getElementById("weather-empty").hidden = true;
  document.getElementById("weather-data").hidden = false;
  document.getElementById("temp-value").textContent = formatTemperature(weather.temperature);
  document.getElementById("condition").textContent = weatherLabel(weather.weatherCode);
  document.getElementById("humidity").textContent = `湿度 ${formatHumidity(weather.humidity)}`;
  document.getElementById("uv").textContent = `紫外线 ${formatUv(weather.uvIndex)}`;
  const tip = clothingTip(weather);
  const clothing = document.getElementById("clothing");
  clothing.hidden = !tip;
  clothing.textContent = tip ? `穿衣：${tip}` : "";
  document.getElementById("stale-tag").hidden = !stale;
}

function showMainView() {
  document.getElementById("main-view").hidden = false;
  document.getElementById("search-view").hidden = true;
}

function showSearchView() {
  document.getElementById("main-view").hidden = true;
  document.getElementById("search-view").hidden = false;
  const input = document.getElementById("search-input");
  input.focus();
  input.select();
}

function renderResults(places) {
  const list = document.getElementById("search-results");
  list.replaceChildren();
  for (const place of places) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result-item";
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
  }
}

async function refreshWeather(location) {
  const id = ++requestSerial;
  const showingData = !document.getElementById("weather-data").hidden;
  if (!showingData) showWeatherEmpty("正在获取天气…");
  try {
    const result = await window.widget.getWeather(location);
    if (id !== requestSerial) return;
    if (result.weather) {
      renderWeather(result.weather, { stale: Boolean(result.stale) });
      setStatus(result.message, Boolean(result.stale));
      return;
    }
    showWeatherEmpty("天气获取失败");
    setStatus(result.message || "天气获取失败", true);
  } catch {
    if (id !== requestSerial) return;
    showWeatherEmpty("天气获取失败");
    setStatus("天气获取失败", true);
  }
}

async function choosePlace(place) {
  showMainView();
  const saved = await window.widget.saveLocation(place);
  if (!saved || !saved.ok) {
    showWeatherEmpty("天气获取失败");
    setStatus("天气获取失败", true);
    return;
  }
  currentLocation = saved.location;
  renderLocation(currentLocation);
  if (saved.weather) renderWeather(saved.weather, { stale: false });
  else showWeatherEmpty("正在获取天气…");
  await refreshWeather(currentLocation);
}

function bindUi() {
  document.getElementById("search-toggle").addEventListener("click", showSearchView);
  document.getElementById("search-back").addEventListener("click", showMainView);
  document.getElementById("close-button").addEventListener("click", () => {
    if (window.widget) window.widget.close();
  });
  document.getElementById("search-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("search-input");
    const button = document.getElementById("search-button");
    const message = document.getElementById("search-message");
    const query = input.value.trim();
    message.textContent = "";
    document.getElementById("search-results").replaceChildren();
    if (!query) {
      message.textContent = "没有找到相关地点";
      return;
    }
    if (!window.widget) return;
    button.disabled = true;
    try {
      const response = await window.widget.searchPlaces(query);
      if (!response.ok) {
        message.textContent = response.message || "没有找到相关地点";
        return;
      }
      renderResults(response.places);
    } catch {
      message.textContent = "地点搜索失败";
    } finally {
      button.disabled = false;
    }
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
