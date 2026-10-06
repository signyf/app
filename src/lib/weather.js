const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const {
  normalizeAdcode,
  buildAmapWeatherUrl,
  buildAmapRegeoUrl,
  parseAmapAdcode,
  parseAmapLive,
} = require("./amap-weather");

const WEATHER_LABELS = {
  0: "晴",
  1: "大部晴朗",
  2: "多云",
  3: "阴",
  45: "有雾",
  48: "雾凇",
  51: "小毛毛雨",
  53: "毛毛雨",
  55: "浓毛毛雨",
  56: "冻毛毛雨",
  57: "强冻毛毛雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "冻雨",
  67: "强冻雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "雪粒",
  80: "阵雨",
  81: "较强阵雨",
  82: "强阵雨",
  85: "阵雪",
  86: "强阵雪",
  95: "雷暴",
  96: "雷暴伴冰雹",
  99: "强雷暴伴冰雹",
};

function weatherLabel(code) {
  return Object.prototype.hasOwnProperty.call(WEATHER_LABELS, code)
    ? WEATHER_LABELS[code]
    : "未知";
}

function weatherMark(code) {
  if (code == null || code === "") return "cloud";
  const value = Number(code);
  if (!Number.isInteger(value)) return "cloud";
  if (value === 0) return "sun";
  if (value === 45 || value === 48) return "fog";
  if ((value >= 51 && value <= 67) || (value >= 80 && value <= 82) || value >= 95) return "rain";
  if ((value >= 71 && value <= 77) || value === 85 || value === 86) return "snow";
  return "cloud";
}

function formatTemperature(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return String(Math.round(value));
}

function formatHumidity(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return `${Math.round(value)}%`;
}

function formatUv(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatUpdateTime(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const options = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  if (timeZone) options.timeZone = timeZone;
  const parts = new Intl.DateTimeFormat("en-GB", options).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!hour || !minute) return "";
  return `${hour}:${minute}`;
}

function describeWeatherStatus({ ok, stale, fetchedAt, timeZone }) {
  if (ok) {
    const clock = formatUpdateTime(fetchedAt, timeZone);
    return clock ? `更新于 ${clock}` : "已更新";
  }
  if (stale) {
    const clock = formatUpdateTime(fetchedAt, timeZone);
    return clock ? `天气获取失败 · 上次数据 ${clock}` : "天气获取失败 · 上次数据";
  }
  return "天气获取失败";
}

function samePlace(a, b) {
  if (!a || !b) return false;
  return Math.abs(a.latitude - b.latitude) < 0.0001
    && Math.abs(a.longitude - b.longitude) < 0.0001;
}

function parseOpenMeteoPayload(payload) {
  const current = payload && payload.current;
  if (!current) return null;
  const temperature = current.temperature_2m;
  const humidity = current.relative_humidity_2m;
  const weatherCode = current.weather_code;
  const numeric = [temperature, humidity, weatherCode];
  if (!numeric.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const uv = current.uv_index;
  const uvIndex = typeof uv === "number" && Number.isFinite(uv) ? uv : null;
  return {
    temperature,
    humidity,
    uvIndex,
    weatherCode,
    observedAt: typeof current.time === "string" ? current.time : null,
  };
}

function buildForecastUrl(latitude, longitude) {
  const url = new URL(FORECAST_ENDPOINT);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,weather_code,uv_index");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");
  return url.toString();
}

function buildUvUrl(latitude, longitude) {
  const url = new URL(FORECAST_ENDPOINT);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "uv_index");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");
  return url.toString();
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response || response.ok !== true) {
    const error = new Error("weather failed");
    error.status = response && typeof response.status === "number" ? response.status : undefined;
    throw error;
  }
  return response.json();
}

async function fetchUvIndex(latitude, longitude, fetchImpl) {
  const payload = await fetchJson(buildUvUrl(latitude, longitude), fetchImpl);
  const uv = payload && payload.current ? payload.current.uv_index : null;
  return typeof uv === "number" && Number.isFinite(uv) ? uv : null;
}

async function readAmapWeather(location, { amapKey, fetchImpl = globalThis.fetch, now } = {}) {
  let adcode = normalizeAdcode(location && location.adcode);
  if (!adcode) {
    const located = await fetchJson(
      buildAmapRegeoUrl(location.latitude, location.longitude, amapKey),
      fetchImpl,
    );
    adcode = parseAmapAdcode(located);
    if (!adcode) throw new Error("weather failed");
  }
  const live = parseAmapLive(await fetchJson(buildAmapWeatherUrl(adcode, amapKey), fetchImpl));
  if (!live) throw new Error("weather failed");
  let uvIndex = null;
  try {
    uvIndex = await fetchUvIndex(location.latitude, location.longitude, fetchImpl);
  } catch {
    uvIndex = null;
  }
  return {
    adcode,
    weather: {
      temperature: live.temperature,
      humidity: live.humidity,
      uvIndex,
      weatherCode: null,
      condition: live.condition,
      source: "amap",
      observedAt: live.observedAt,
      fetchedAt: now,
    },
  };
}

async function loadPlaceWeather(location, { amapKey = "", fetchImpl = globalThis.fetch, now } = {}) {
  const key = typeof amapKey === "string" ? amapKey.trim() : "";
  if (!key) {
    const payload = await fetchWeatherPayload(location.latitude, location.longitude, { fetchImpl });
    const view = resolveWeatherView({
      requested: location,
      payload,
      error: false,
      now,
      cachedLocation: null,
      cachedWeather: null,
    });
    if (!view.ok || !view.weather) throw new Error("weather failed");
    return { adcode: "", weather: view.weather };
  }
  return readAmapWeather(location, { amapKey: key, fetchImpl, now });
}

function resolveWeatherView({
  requested,
  cachedLocation,
  cachedWeather,
  payload,
  error,
  now,
  timeZone,
}) {
  const parsed = !error && payload ? parseOpenMeteoPayload(payload) : null;
  if (parsed) {
    const weather = {
      ...parsed,
      condition: "",
      source: "open-meteo",
      fetchedAt: now,
    };
    return {
      ok: true,
      stale: false,
      weather,
      message: describeWeatherStatus({
        ok: true,
        stale: false,
        fetchedAt: now,
        timeZone,
      }),
    };
  }

  const cacheMatches = cachedWeather
    && cachedLocation
    && requested
    && samePlace(cachedLocation, requested);
  if (cacheMatches) {
    return {
      ok: false,
      stale: true,
      weather: cachedWeather,
      message: describeWeatherStatus({
        ok: false,
        stale: true,
        fetchedAt: cachedWeather.fetchedAt,
        timeZone,
      }),
    };
  }

  return {
    ok: false,
    stale: false,
    weather: null,
    message: "天气获取失败",
  };
}

async function fetchWeatherPayload(latitude, longitude, { fetchImpl = globalThis.fetch } = {}) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new TypeError("invalid coordinates");
  }
  const response = await fetchImpl(buildForecastUrl(latitude, longitude), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const error = new Error("weather failed");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

module.exports = {
  buildForecastUrl,
  buildUvUrl,
  describeWeatherStatus,
  fetchWeatherPayload,
  formatHumidity,
  formatTemperature,
  formatUpdateTime,
  formatUv,
  loadPlaceWeather,
  parseOpenMeteoPayload,
  readAmapWeather,
  resolveWeatherView,
  samePlace,
  weatherLabel,
  weatherMark,
};
