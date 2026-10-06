const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAmapRegeoUrl,
  buildAmapWeatherUrl,
  markForAmapWeather,
  parseAmapAdcode,
  parseAmapLive,
} = require("../src/lib/amap-weather");
const { loadPlaceWeather } = require("../src/lib/weather");

const place = { name: "中山公园", detail: "广东省佛山市禅城区", latitude: 23.02, longitude: 113.12 };
const KEY = "test-key";

function livePayload(weather = "多云") {
  return {
    status: "1",
    infocode: "10000",
    lives: [{
      weather,
      temperature: "23",
      humidity: "48",
      temperature_float: "23.0",
      humidity_float: "48.0",
      reporttime: "2026-10-06 11:00:00",
      adcode: "440604",
    }],
  };
}

test("高德实况请求带上区县编码和 extensions=base", () => {
  const url = new URL(buildAmapWeatherUrl("440604", KEY));
  assert.equal(url.origin + url.pathname, "https://restapi.amap.com/v3/weather/weatherInfo");
  assert.equal(url.searchParams.get("city"), "440604");
  assert.equal(url.searchParams.get("extensions"), "base");
  assert.equal(url.searchParams.get("key"), KEY);
  const regeo = new URL(buildAmapRegeoUrl(23.02, 113.12, KEY));
  assert.equal(regeo.origin + regeo.pathname, "https://restapi.amap.com/v3/geocode/regeo");
  assert.equal(regeo.searchParams.get("location"), "113.12,23.02");
});

test("实况原文直接用作天气现象，失败信息里没有 Key", () => {
  assert.deepEqual(parseAmapLive(livePayload("晴")), {
    condition: "晴",
    temperature: 23,
    humidity: 48,
    observedAt: "2026-10-06 11:00:00",
  });
  assert.equal(parseAmapLive(livePayload("多云")).condition, "多云");
  assert.equal(parseAmapAdcode({
    status: "1",
    regeocode: { addressComponent: { adcode: "440604" } },
  }), "440604");
  assert.throws(() => parseAmapLive({ status: "0", info: `bad ${KEY}`, infocode: "10001" }), (error) => {
    assert.equal(error.message, "weather failed");
    assert.equal(error.message.includes(KEY), false);
    assert.equal(error.infocode, "10001");
    return true;
  });
});

test("有 Key 时天空、气温、湿度来自高德，紫外线来自 Open-Meteo", async () => {
  const seen = [];
  const result = await loadPlaceWeather(place, {
    amapKey: KEY,
    now: "2026-10-06T03:00:00.000Z",
    fetchImpl: async (url) => {
      const href = String(url);
      seen.push(href);
      if (href.includes("/geocode/regeo")) {
        return { ok: true, json: async () => ({ status: "1", regeocode: { addressComponent: { adcode: "440604" } } }) };
      }
      if (href.includes("/weather/weatherInfo")) {
        const params = new URL(href).searchParams;
        assert.equal(params.get("extensions"), "base");
        assert.equal(params.get("city"), "440604");
        return { ok: true, json: async () => livePayload("多云") };
      }
      if (href.includes("open-meteo.com")) {
        return { ok: true, json: async () => ({ current: { uv_index: 2.2 } }) };
      }
      throw new Error("unexpected");
    },
  });
  assert.equal(result.adcode, "440604");
  assert.equal(result.weather.condition, "多云");
  assert.equal(result.weather.source, "amap");
  assert.equal(result.weather.weatherCode, null);
  assert.equal(result.weather.temperature, 23);
  assert.equal(result.weather.humidity, 48);
  assert.equal(result.weather.uvIndex, 2.2);
  assert.equal(seen.some((href) => href.includes("weather_code")), false);
});

test("已有 adcode 时不再反查，紫外线失败则留空", async () => {
  const seen = [];
  const result = await loadPlaceWeather({ ...place, adcode: "440604" }, {
    amapKey: KEY,
    now: "2026-10-06T03:00:00.000Z",
    fetchImpl: async (url) => {
      const href = String(url);
      seen.push(href);
      if (href.includes("/geocode/regeo")) throw new Error("should not reverse");
      if (href.includes("/weather/weatherInfo")) {
        return { ok: true, json: async () => livePayload("阴") };
      }
      if (href.includes("open-meteo.com")) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      throw new Error("unexpected");
    },
  });
  assert.equal(seen.some((href) => href.includes("/geocode/regeo")), false);
  assert.equal(result.weather.condition, "阴");
  assert.equal(result.weather.uvIndex, null);
});

test("没有 Key 时仍请求 Open-Meteo，不会去打高德", async () => {
  const seen = [];
  const result = await loadPlaceWeather(place, {
    amapKey: "",
    now: "2026-10-06T03:00:00.000Z",
    fetchImpl: async (url) => {
      const href = String(url);
      seen.push(href);
      if (href.includes("amap.com")) throw new Error("amap was called");
      return {
        ok: true,
        json: async () => ({
          current: {
            time: "2026-10-06T11:00",
            temperature_2m: 21,
            relative_humidity_2m: 40,
            weather_code: 2,
            uv_index: 1,
          },
        }),
      };
    },
  });
  assert.equal(result.weather.source, "open-meteo");
  assert.equal(result.weather.weatherCode, 2);
  assert.equal(result.weather.condition, "");
  assert.equal(seen.length, 1);
});

test("高德天气原文只决定球上的标记，不改成 Open-Meteo 文案", () => {
  assert.equal(markForAmapWeather("晴"), "sun");
  assert.equal(markForAmapWeather("多云"), "cloud");
  assert.equal(markForAmapWeather("晴间多云"), "cloud");
  assert.equal(markForAmapWeather("小雨"), "rain");
  assert.equal(markForAmapWeather("小雪"), "snow");
  assert.equal(markForAmapWeather("雾"), "fog");
});
