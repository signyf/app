const fs = require("fs");
const path = require("path");
const { normalizeAdcode } = require("../src/lib/amap-weather");

function finiteOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeLocation(value) {
  if (!value || typeof value !== "object") return null;
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const detail = typeof value.detail === "string" ? value.detail.trim() : "";
  return { name, detail, latitude, longitude, adcode: normalizeAdcode(value.adcode) };
}

function normalizeWeather(value) {
  if (!value || typeof value !== "object") return null;
  const temperature = Number(value.temperature);
  const humidity = Number(value.humidity);
  if (![temperature, humidity].every((item) => Number.isFinite(item))) return null;
  const condition = typeof value.condition === "string" ? value.condition.trim() : "";
  const weatherCode = finiteOrNull(value.weatherCode);
  const source = value.source === "amap" ? "amap" : "open-meteo";
  if (source === "amap" && !condition) return null;
  if (source !== "amap" && weatherCode == null) return null;
  let uvIndex = null;
  if (value.uvIndex !== null && value.uvIndex !== undefined) {
    const uv = Number(value.uvIndex);
    uvIndex = Number.isFinite(uv) ? uv : null;
  }
  const fetchedAt = typeof value.fetchedAt === "string" ? value.fetchedAt : "";
  if (!fetchedAt || Number.isNaN(new Date(fetchedAt).getTime())) return null;
  const observedAt = typeof value.observedAt === "string" ? value.observedAt : null;
  return {
    temperature,
    humidity,
    uvIndex,
    weatherCode,
    condition,
    source,
    observedAt,
    fetchedAt,
  };
}

function normalizeWindow(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const edge = value.edge === "left" || value.edge === "right" || value.edge === "top" || value.edge === "bottom"
    ? value.edge
    : null;
  const anchor = Number(value.anchor);
  return {
    x: Math.round(x),
    y: Math.round(y),
    edge,
    anchor: Number.isFinite(anchor) ? Math.round(anchor) : null,
  };
}

function emptyState() {
  return { location: null, weather: null, window: null };
}

function createStore(filePath) {
  function load() {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!data || typeof data !== "object") return emptyState();
      const location = normalizeLocation(data.location);
      return {
        location,
        weather: location ? normalizeWeather(data.weather) : null,
        window: normalizeWindow(data.window),
      };
    } catch {
      return emptyState();
    }
  }

  function save(state) {
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true });
    const tmp = path.join(directory, `.${path.basename(filePath)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.copyFileSync(tmp, filePath);
    fs.rmSync(tmp, { force: true });
  }

  function update(recipe) {
    const next = recipe(load());
    save(next);
    return next;
  }

  return { load, save, update };
}

module.exports = {
  createStore,
  normalizeLocation,
  normalizeWeather,
  normalizeWindow,
};
