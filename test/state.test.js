const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createStore, normalizeLocation } = require("../electron/state");
const { initialPosition } = require("../electron/placement");

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tianqi-"));
  return path.join(dir, "widget-state.json");
}

test("store persists a selected location and drops a corrupt file", () => {
  const file = tempFile();
  const store = createStore(file);
  assert.deepEqual(store.load(), { location: null, weather: null, window: null });

  store.save({
    location: {
      name: "  天通苑 · 昌平区  ",
      detail: "天通苑 · 昌平区 · 北京市",
      latitude: 40.07,
      longitude: 116.41,
    },
    weather: {
      temperature: 21,
      humidity: 30,
      uvIndex: null,
      weatherCode: 0,
      observedAt: "2026-10-05T17:00",
      fetchedAt: "2026-10-05T09:00:00.000Z",
    },
    window: { x: 12.4, y: 40.2 },
  });

  const loaded = createStore(file).load();
  assert.equal(loaded.location.name, "天通苑 · 昌平区");
  assert.equal(loaded.weather.uvIndex, null);
  assert.equal(loaded.weather.temperature, 21);
  assert.deepEqual(loaded.window, { x: 12, y: 40, edge: null, anchor: null });

  fs.writeFileSync(file, "{", "utf8");
  assert.deepEqual(createStore(file).load(), { location: null, weather: null, window: null });
});

test("store drops weather that has no location and rejects bad coordinates", () => {
  const file = tempFile();
  fs.writeFileSync(file, JSON.stringify({
    weather: {
      temperature: 1,
      humidity: 2,
      weatherCode: 0,
      fetchedAt: "2026-10-05T09:00:00.000Z",
    },
  }));
  assert.equal(createStore(file).load().weather, null);
  assert.equal(normalizeLocation({ name: "火星", latitude: 120, longitude: 10 }), null);
});

test("高德实况可以没有天气代码，地点可以记下区县编码", () => {
  const file = tempFile();
  const store = createStore(file);
  store.save({
    location: {
      name: "中山公园",
      detail: "广东省佛山市禅城区中山公园",
      latitude: 23.02,
      longitude: 113.12,
      adcode: "440604",
    },
    weather: {
      temperature: 23,
      humidity: 48,
      uvIndex: null,
      weatherCode: null,
      condition: "多云",
      source: "amap",
      observedAt: "2026-10-06 11:00:00",
      fetchedAt: "2026-10-06T03:00:00.000Z",
    },
  });
  const loaded = createStore(file).load();
  assert.equal(loaded.location.adcode, "440604");
  assert.equal(loaded.weather.condition, "多云");
  assert.equal(loaded.weather.source, "amap");
  assert.equal(loaded.weather.weatherCode, null);
  assert.equal(loaded.weather.uvIndex, null);
});

test("saved window position is reused only when it is still on a display", () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  assert.deepEqual(initialPosition({ x: 100, y: 80 }, displays), { x: 100, y: 80 });
  assert.deepEqual(initialPosition({ x: -5000, y: 10 }, displays), {});
  assert.deepEqual(initialPosition(null, displays), {});
});
