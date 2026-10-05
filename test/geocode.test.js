const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSearchUrl, parseNominatimResults, searchPlaces } = require("../src/lib/geocode");

const WANGJING = {
  place_id: 11,
  lat: "40.0001",
  lon: "116.4702",
  name: "望京花园",
  display_name: "望京花园, 利泽中二路, 白家坟, 东湖街道, 朝阳区, 北京市, 100102, 中国",
  address: {
    highway: "望京花园",
    road: "利泽中二路",
    neighbourhood: "白家坟",
    suburb: "东湖街道",
    city: "朝阳区",
    postcode: "100102",
    country: "中国",
  },
};

const TIANTONGYUAN = {
  place_id: 22,
  lat: "40.0726643",
  lon: "116.4087263",
  name: "天通苑",
  display_name: "天通苑, 太平庄中二街, 天通苑北街道, 昌平区, 北京市, 102218, 中国",
  address: {
    railway: "天通苑",
    road: "太平庄中二街",
    suburb: "天通苑北街道",
    city: "昌平区",
    country: "中国",
  },
};

test("buildSearchUrl keeps the Chinese query and asks for address details", () => {
  const url = new URL(buildSearchUrl("望京花园"));
  assert.equal(url.origin + url.pathname, "https://nominatim.openstreetmap.org/search");
  assert.equal(url.searchParams.get("q"), "望京花园");
  assert.equal(url.searchParams.get("format"), "json");
  assert.equal(url.searchParams.get("addressdetails"), "1");
  assert.equal(url.searchParams.get("accept-language"), "zh-CN");
  assert.equal(url.searchParams.get("limit"), "8");
});

test("parseNominatimResults names a residential search result and drops bad rows", () => {
  const places = parseNominatimResults([
    WANGJING,
    TIANTONGYUAN,
    { place_id: 3, lat: "nope", lon: "116.4", name: "无效", display_name: "无效" },
    { ...TIANTONGYUAN, place_id: 99 },
  ]);

  assert.equal(places.length, 2);
  assert.deepEqual(places[0], {
    id: "11",
    name: "望京花园 · 白家坟 · 朝阳区",
    detail: "望京花园 · 利泽中二路 · 白家坟 · 东湖街道 · 朝阳区 · 北京市",
    latitude: 40.0001,
    longitude: 116.4702,
  });
  assert.equal(places[1].name, "天通苑 · 天通苑北街道 · 昌平区");
  assert.equal(places[1].detail, "天通苑 · 太平庄中二街 · 天通苑北街道 · 昌平区 · 北京市");
});

test("parseNominatimResults falls back to the display name and skips non-arrays", () => {
  const places = parseNominatimResults([
    {
      place_id: 4,
      lat: "31.23",
      lon: "121.47",
      display_name: "人民广场, 黄浦区, 上海市, 200001, 中国",
    },
  ]);
  assert.equal(places[0].name, "人民广场 · 黄浦区 · 上海市");
  assert.equal(parseNominatimResults({ error: "Unable to geocode" }).length, 0);
});

test("parseNominatimResults shortens a city result with its province", () => {
  const places = parseNominatimResults([
    {
      place_id: 5,
      lat: "30.25",
      lon: "120.16",
      name: "杭州",
      display_name: "杭州, 杭州市, 浙江省, 中国",
      address: { city: "杭州市", state: "浙江省", country: "中国" },
    },
  ]);
  assert.equal(places[0].name, "杭州 · 浙江省");
});

test("searchPlaces parses a neighborhood payload and sends a user agent", async () => {
  let seen = null;
  const places = await searchPlaces("  天通苑  ", {
    userAgent: "tianqi-widget-test",
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return { ok: true, json: async () => [TIANTONGYUAN] };
    },
  });
  assert.equal(places[0].name, "天通苑 · 天通苑北街道 · 昌平区");
  assert.equal(new URL(seen.url).searchParams.get("q"), "天通苑");
  assert.equal(seen.options.headers["User-Agent"], "tianqi-widget-test");
});

test("searchPlaces does not fetch a blank query and throws when the service fails", async () => {
  let called = false;
  const empty = await searchPlaces("   ", {
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => [] };
    },
  });
  assert.equal(called, false);
  assert.deepEqual(empty, []);

  await assert.rejects(() => searchPlaces("天通苑", {
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  }));
});
