const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildForecastUrl,
  describeWeatherStatus,
  fetchWeatherPayload,
  formatHumidity,
  formatTemperature,
  formatUv,
  parseOpenMeteoPayload,
  resolveWeatherView,
  samePlace,
  weatherLabel,
} = require("../src/lib/weather");

const place = { name: "天通苑", detail: "", latitude: 40.07, longitude: 116.41 };
const other = { name: "杭州", detail: "", latitude: 30.25, longitude: 120.16 };
const cached = {
  temperature: 18,
  humidity: 40,
  uvIndex: 1,
  weatherCode: 2,
  observedAt: "2026-10-05T16:00",
  fetchedAt: "2026-10-05T08:16:00.000Z",
};

test("buildForecastUrl asks Open-Meteo for temperature, humidity and UV", () => {
  const url = new URL(buildForecastUrl(39.9, 116.4));
  assert.equal(url.origin + url.pathname, "https://api.open-meteo.com/v1/forecast");
  assert.equal(url.searchParams.get("latitude"), "39.9");
  assert.equal(url.searchParams.get("longitude"), "116.4");
  assert.equal(url.searchParams.get("current"), "temperature_2m,relative_humidity_2m,weather_code,uv_index");
  assert.equal(url.searchParams.get("timezone"), "auto");
});

test("parseOpenMeteoPayload reads the current block and ignores malformed payloads", () => {
  const parsed = parseOpenMeteoPayload({
    current: {
      time: "2026-10-05T17:45",
      temperature_2m: 20.9,
      relative_humidity_2m: 24,
      weather_code: 0,
      uv_index: 0.05,
    },
  });
  assert.deepEqual(parsed, {
    temperature: 20.9,
    humidity: 24,
    uvIndex: 0.05,
    weatherCode: 0,
    observedAt: "2026-10-05T17:45",
  });
  assert.equal(parseOpenMeteoPayload({}), null);
  assert.equal(parseOpenMeteoPayload({
    current: { temperature_2m: "20", relative_humidity_2m: 1, weather_code: 0 },
  }), null);
  assert.equal(parseOpenMeteoPayload({
    current: { temperature_2m: 20, relative_humidity_2m: 1, weather_code: 0 },
  }).uvIndex, null);
});

test("formatters and condition labels stay short", () => {
  assert.equal(formatTemperature(20.9), "21");
  assert.equal(formatTemperature(-1.2), "-1");
  assert.equal(formatHumidity(24.2), "24%");
  assert.equal(formatUv(0.05), "0.1");
  assert.equal(formatUv(4), "4");
  assert.equal(formatUv(null), "--");
  assert.equal(weatherLabel(0), "晴");
  assert.equal(weatherLabel(61), "小雨");
  assert.equal(weatherLabel(95), "雷暴");
  assert.equal(weatherLabel(123), "未知");
});

test("status text marks a failed refresh that still has a previous reading", () => {
  assert.equal(describeWeatherStatus({
    ok: true,
    stale: false,
    fetchedAt: "2026-10-05T01:41:00.000Z",
    timeZone: "Asia/Shanghai",
  }), "更新于 09:41");
  assert.equal(describeWeatherStatus({
    ok: false,
    stale: true,
    fetchedAt: "2026-10-05T08:16:00.000Z",
    timeZone: "Asia/Shanghai",
  }), "天气获取失败 · 上次数据 16:16");
  assert.equal(describeWeatherStatus({ ok: false, stale: false }), "天气获取失败");
});

test("resolveWeatherView keeps the last reading only for the same place", () => {
  const fresh = resolveWeatherView({
    requested: place,
    cachedLocation: place,
    cachedWeather: cached,
    payload: {
      current: {
        time: "2026-10-05T17:45",
        temperature_2m: 21.2,
        relative_humidity_2m: 30,
        weather_code: 1,
        uv_index: 0.2,
      },
    },
    error: false,
    now: "2026-10-05T09:45:00.000Z",
    timeZone: "Asia/Shanghai",
  });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.weather.temperature, 21.2);
  assert.equal(fresh.message, "更新于 17:45");

  const stale = resolveWeatherView({
    requested: place,
    cachedLocation: place,
    cachedWeather: cached,
    payload: null,
    error: true,
    now: "2026-10-05T09:50:00.000Z",
    timeZone: "Asia/Shanghai",
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.weather, cached);
  assert.match(stale.message, /^天气获取失败 · 上次数据/);

  const missed = resolveWeatherView({
    requested: other,
    cachedLocation: place,
    cachedWeather: cached,
    payload: { current: {} },
    error: true,
    now: "2026-10-05T09:50:00.000Z",
  });
  assert.deepEqual(missed, {
    ok: false,
    stale: false,
    weather: null,
    message: "天气获取失败",
  });
});

test("samePlace tolerates tiny coordinate noise", () => {
  assert.equal(samePlace(place, { latitude: 40.07001, longitude: 116.41002 }), true);
  assert.equal(samePlace(place, other), false);
});

test("fetchWeatherPayload returns the service JSON", async () => {
  const payload = await fetchWeatherPayload(39.9, 116.4, {
    fetchImpl: async (url) => {
      assert.match(url, /latitude=39\.9/);
      return {
        ok: true,
        json: async () => ({ current: { temperature_2m: 1, relative_humidity_2m: 2, weather_code: 0, uv_index: 3 } }),
      };
    },
  });
  assert.equal(payload.current.uv_index, 3);
  await assert.rejects(() => fetchWeatherPayload(Number.NaN, 1, { fetchImpl: async () => ({ ok: true }) }));
});
