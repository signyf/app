const AMAP_WEATHER_ENDPOINT = "https://restapi.amap.com/v3/weather/weatherInfo";
const AMAP_REGEO_ENDPOINT = "https://restapi.amap.com/v3/geocode/regeo";

function normalizeAdcode(value) {
  const text = typeof value === "string"
    ? value.trim()
    : (typeof value === "number" && Number.isInteger(value) ? String(value) : "");
  return /^\d{6}$/.test(text) ? text : "";
}

function buildAmapWeatherUrl(adcode, key) {
  const url = new URL(AMAP_WEATHER_ENDPOINT);
  url.searchParams.set("city", adcode);
  url.searchParams.set("extensions", "base");
  url.searchParams.set("output", "JSON");
  url.searchParams.set("key", key);
  return url.toString();
}

function buildAmapRegeoUrl(latitude, longitude, key) {
  const url = new URL(AMAP_REGEO_ENDPOINT);
  url.searchParams.set("location", `${longitude},${latitude}`);
  url.searchParams.set("extensions", "base");
  url.searchParams.set("output", "JSON");
  url.searchParams.set("key", key);
  return url.toString();
}

function failed(payload) {
  const error = new Error("weather failed");
  error.infocode = payload && payload.infocode != null ? String(payload.infocode) : "";
  return error;
}

function parseAmapAdcode(payload) {
  if (!payload || typeof payload !== "object" || String(payload.status) === "0") throw failed(payload);
  const component = payload.regeocode && payload.regeocode.addressComponent;
  return normalizeAdcode(component && component.adcode);
}

function parseAmapLive(payload) {
  if (!payload || typeof payload !== "object" || String(payload.status) === "0") throw failed(payload);
  const live = Array.isArray(payload.lives) ? payload.lives[0] : null;
  if (!live || typeof live !== "object") return null;
  const condition = typeof live.weather === "string" ? live.weather.trim() : "";
  const temperature = Number(
    live.temperature_float != null && live.temperature_float !== ""
      ? live.temperature_float
      : live.temperature,
  );
  const humidity = Number(
    live.humidity_float != null && live.humidity_float !== ""
      ? live.humidity_float
      : live.humidity,
  );
  if (!condition || !Number.isFinite(temperature) || !Number.isFinite(humidity)) return null;
  return {
    condition,
    temperature,
    humidity,
    observedAt: typeof live.reporttime === "string" ? live.reporttime : null,
  };
}

function markForAmapWeather(text) {
  const value = typeof text === "string" ? text : "";
  if (value.includes("雪")) return "snow";
  if (value.includes("雨") || value.includes("雷")) return "rain";
  if (value.includes("雾") || value.includes("霾") || value.includes("沙") || value.includes("尘")) return "fog";
  if (value.includes("晴") && !value.includes("云") && !value.includes("阴")) return "sun";
  return "cloud";
}

module.exports = {
  normalizeAdcode,
  buildAmapWeatherUrl,
  buildAmapRegeoUrl,
  parseAmapAdcode,
  parseAmapLive,
  markForAmapWeather,
};
