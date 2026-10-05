const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PROVIDER_TIMEOUT_MS,
  buildAmapUrl,
  buildOpenMeteoUrl,
  buildPhotonUrl,
  buildSearchUrl,
  expandQueries,
  parseAmapResults,
  parseNominatimResults,
  parseOpenMeteoResults,
  parsePhotonResults,
  searchPlaces,
} = require("../src/lib/geocode");

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

test("searchPlaces does not fetch a blank query and throws when every provider fails", async () => {
  let called = false;
  const empty = await searchPlaces("   ", {
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => [] };
    },
  });
  assert.equal(called, false);
  assert.deepEqual(empty, []);

  const logs = [];
  await assert.rejects(
    () => searchPlaces("天通苑", {
      log: (line) => logs.push(line),
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ secret: "SECRET_BODY" }) }),
    }),
    /search failed/,
  );
  assert.deepEqual(logs, [
    "[geocode] nominatim: http 503",
    "[geocode] open-meteo: http 503",
    "[geocode] photon: http 503",
  ]);
  assert.equal(logs.some((line) => line.includes("SECRET_BODY")), false);
});

const FOSHAN_METEO = {
  id: 1811103,
  name: "佛山市",
  latitude: 23.02677,
  longitude: 113.13148,
  country: "中国",
  admin1: "广东",
  admin2: "佛山市",
};

const TIANTONGYUAN_PHOTON = {
  type: "Feature",
  properties: {
    osm_type: "N",
    osm_id: 5444679354,
    name: "天通苑",
    street: "立汤路",
    district: "天通苑北街道",
    city: "北京市",
    country: "中国",
  },
  geometry: { type: "Point", coordinates: [116.4066402, 40.0737747] },
};

test("fallback urls ask Open-Meteo for Chinese and Photon for a short list", () => {
  const meteo = new URL(buildOpenMeteoUrl("佛山市"));
  assert.equal(meteo.origin + meteo.pathname, "https://geocoding-api.open-meteo.com/v1/search");
  assert.equal(meteo.searchParams.get("name"), "佛山市");
  assert.equal(meteo.searchParams.get("language"), "zh");
  assert.equal(meteo.searchParams.get("count"), "8");
  const photon = new URL(buildPhotonUrl("天通苑"));
  assert.equal(photon.origin + photon.pathname, "https://photon.komoot.io/api/");
  assert.equal(photon.searchParams.get("q"), "天通苑");
  assert.equal(photon.searchParams.get("limit"), "8");
  assert.equal(photon.searchParams.get("lang"), null);
  assert.ok(PROVIDER_TIMEOUT_MS >= 1000 && PROVIDER_TIMEOUT_MS <= 8000);
});

test("parseOpenMeteoResults names a city and skips an empty payload", () => {
  const places = parseOpenMeteoResults({
    results: [
      FOSHAN_METEO,
      { id: 1, name: "坏坐标", latitude: 999, longitude: 10 },
      FOSHAN_METEO,
    ],
  });
  assert.equal(places.length, 1);
  assert.deepEqual(places[0], {
    id: "1811103",
    name: "佛山市 · 广东",
    detail: "佛山市 · 广东",
    latitude: 23.02677,
    longitude: 113.13148,
  });
  assert.equal(parseOpenMeteoResults({ generationtime_ms: 0.2 }).length, 0);
});

test("parsePhotonResults names a neighborhood from longitude-first coordinates", () => {
  const places = parsePhotonResults({
    features: [
      TIANTONGYUAN_PHOTON,
      { type: "Feature", properties: { name: "无名" }, geometry: { type: "Point", coordinates: [] } },
    ],
  });
  assert.equal(places.length, 1);
  assert.equal(places[0].id, "N:5444679354");
  assert.equal(places[0].name, "天通苑 · 天通苑北街道 · 北京市");
  assert.equal(places[0].detail, "天通苑 · 立汤路 · 天通苑北街道 · 北京市");
  assert.equal(places[0].latitude, 40.0737747);
  assert.equal(places[0].longitude, 116.4066402);
});

function providerOf(url) {
  const href = String(url);
  if (href.includes("nominatim.openstreetmap.org")) return "nominatim";
  if (href.includes("geocoding-api.open-meteo.com")) return "open-meteo";
  if (href.includes("photon.komoot.io")) return "photon";
  if (href.includes("restapi.amap.com")) return "amap";
  return "other";
}

function queryOf(url) {
  const params = new URL(String(url)).searchParams;
  return params.get("q") || params.get("name") || params.get("address") || "";
}

test("searchPlaces returns the first provider that has matches", async () => {
  const calls = [];
  const places = await searchPlaces("天通苑", {
    log: () => {},
    fetchImpl: async (url) => {
      calls.push(providerOf(url));
      return { ok: true, json: async () => [TIANTONGYUAN] };
    },
  });
  assert.equal(places[0].name, "天通苑 · 天通苑北街道 · 昌平区");
  assert.deepEqual(calls, ["nominatim"]);
});

test("searchPlaces uses Open-Meteo when Nominatim fails and does not leak the status", async () => {
  const logs = [];
  const calls = [];
  const places = await searchPlaces("佛山市", {
    log: (line) => logs.push(line),
    fetchImpl: async (url) => {
      const provider = providerOf(url);
      calls.push(provider);
      if (provider === "nominatim") {
        const error = new TypeError("fetch failed");
        error.cause = Object.assign(new Error("getaddrinfo ENOTFOUND nominatim.openstreetmap.org"), {
          code: "ENOTFOUND",
        });
        throw error;
      }
      return { ok: true, json: async () => ({ results: [FOSHAN_METEO] }) };
    },
  });
  assert.equal(places[0].name, "佛山市 · 广东");
  assert.deepEqual(calls, ["nominatim", "open-meteo"]);
  assert.deepEqual(logs, ["[geocode] nominatim: dns"]);
});

test("searchPlaces reaches Photon when earlier providers have no neighborhood match", async () => {
  const calls = [];
  const places = await searchPlaces("天通苑", {
    log: () => {},
    fetchImpl: async (url) => {
      const provider = providerOf(url);
      calls.push(provider);
      if (provider === "nominatim") return { ok: false, status: 429, json: async () => ({}) };
      if (provider === "open-meteo") return { ok: true, json: async () => ({ generationtime_ms: 0.2 }) };
      return { ok: true, json: async () => ({ features: [TIANTONGYUAN_PHOTON] }) };
    },
  });
  assert.equal(places[0].name, "天通苑 · 天通苑北街道 · 北京市");
  assert.deepEqual(calls, ["nominatim", "open-meteo", "photon"]);
});

test("searchPlaces returns no matches when providers answer empty, even if one timed out", async () => {
  const logs = [];
  const places = await searchPlaces("没有这个地方xyz", {
    timeoutMs: 40,
    log: (line) => logs.push(line),
    fetchImpl: (url) => {
      if (providerOf(url) === "nominatim") return new Promise(() => {});
      return Promise.resolve({ ok: true, json: async () => ({ results: [], features: [] }) });
    },
  });
  assert.deepEqual(places, []);
  assert.deepEqual(logs, ["[geocode] nominatim: timeout"]);
});

test("expandQueries shortens a house number to the road and a spaced hint", () => {
  assert.deepEqual(expandQueries("佛山市南海区叠翠路8号"), [
    "佛山市南海区叠翠路8号",
    "佛山市南海区叠翠路",
    "叠翠路 南海 佛山",
  ]);
  assert.deepEqual(expandQueries("天通苑"), ["天通苑"]);
});

test("parseNominatimResults drops a foreign city such as Busan", () => {
  const places = parseNominatimResults([
    {
      place_id: 5,
      lat: "23.0239788",
      lon: "113.1159558",
      name: "佛山市",
      display_name: "佛山市, 南海区, 广东省, 中国",
      address: { city: "佛山市", county: "南海区", state: "广东省", country: "中国", country_code: "cn" },
    },
    {
      place_id: 9,
      lat: "35.1796",
      lon: "129.0756",
      name: "釜山廣域市",
      display_name: "釜山廣域市, 韩国",
      address: { city: "釜山廣域市", country: "韩国", country_code: "kr" },
    },
  ]);
  assert.equal(places.length, 1);
  assert.equal(places[0].name, "佛山市 · 南海区 · 广东省");
});

const NANHAI_ROAD = {
  type: "Feature",
  properties: {
    osm_type: "W",
    osm_id: 842700001,
    osm_key: "highway",
    name: "叠翠路",
    district: "桂城街道",
    county: "南海区",
    city: "佛山市",
    state: "广东省",
    country: "中国",
    countrycode: "CN",
  },
  geometry: { type: "Point", coordinates: [113.1212, 23.052] },
};

test("searchPlaces retries a shorter query and labels a road pin", async () => {
  const calls = [];
  const places = await searchPlaces("佛山市南海区叠翠路8号", {
    log: () => {},
    fetchImpl: async (url) => {
      const provider = providerOf(url);
      const asked = queryOf(url);
      calls.push(`${provider}:${asked}`);
      if (provider === "nominatim") return { ok: false, status: 503, json: async () => ({}) };
      if (provider !== "photon" || asked !== "叠翠路 南海 佛山") {
        return { ok: true, json: async () => ({ results: [], features: [] }) };
      }
      return { ok: true, json: async () => ({ features: [NANHAI_ROAD] }) };
    },
  });
  assert.equal(places.length, 1);
  assert.equal(places[0].name, "叠翠路 · 桂城街道 · 佛山市");
  assert.match(places[0].detail, /^道路位置，不是门牌/);
  assert.equal(places[0].detail.includes("南海区"), true);
  assert.equal(calls.filter((call) => call.startsWith("nominatim:")).length, 1);
  assert.equal(calls.some((call) => call === "photon:叠翠路 南海 佛山"), true);
});

test("searchPlaces ignores a same-named road in another city and a fuzzy city hit", async () => {
  const hefei = {
    ...NANHAI_ROAD,
    properties: {
      ...NANHAI_ROAD.properties,
      osm_id: 2,
      district: "官亭镇",
      county: "肥西县",
      city: "合肥市",
      state: "安徽省",
    },
    geometry: { type: "Point", coordinates: [116.8942, 31.7901] },
  };
  const places = await searchPlaces("佛山市南海区叠翠路8号", {
    log: () => {},
    fetchImpl: async (url) => {
      if (providerOf(url) !== "photon") return { ok: true, json: async () => [] };
      return { ok: true, json: async () => ({ features: [hefei] }) };
    },
  });
  assert.deepEqual(places, []);
});

const AMAP_ROAD = {
  formatted_address: "广东省佛山市南海区叠翠路",
  country: "中国",
  province: "广东省",
  city: "佛山市",
  district: "南海区",
  street: "叠翠路",
  number: [],
  location: "113.121200,23.052000",
  level: "道路",
};

test("parseAmapResults keeps a road and a door at different precision", () => {
  const road = parseAmapResults({ status: "1", geocodes: [AMAP_ROAD] });
  assert.equal(road[0].name, "叠翠路 · 南海区 · 佛山市");
  assert.equal(road[0].latitude, 23.052);
  assert.equal(road[0].longitude, 113.1212);
  const door = parseAmapResults({
    status: "1",
    geocodes: [{
      ...AMAP_ROAD,
      number: "8号",
      level: "门牌号",
      formatted_address: "广东省佛山市南海区叠翠路8号",
      location: "113.121210,23.051970",
    }],
  });
  assert.equal(door[0].name, "叠翠路8号 · 南海区 · 佛山市");
});

test("parseAmapResults throws a status that does not include the key", () => {
  assert.throws(() => parseAmapResults({ status: "0", info: "INVALID_USER_KEY", infocode: "10001" }), (error) => {
    assert.equal(error.infocode, "10001");
    assert.equal(String(error.message).includes("key"), false);
    return true;
  });
});

test("searchPlaces uses Amap for 叠翠路 when keyless providers have no Nanhai road", async () => {
  const seen = [];
  const places = await searchPlaces("佛山市南海区叠翠路8号", {
    amapKey: "test-key",
    log: (line) => seen.push(line),
    fetchImpl: async (url) => {
      const href = String(url);
      if (providerOf(href) !== "amap") return { ok: true, json: async () => [] };
      const params = new URL(href).searchParams;
      assert.equal(params.get("key"), "test-key");
      assert.equal(params.get("city"), "佛山");
      assert.equal(params.get("address"), "佛山市南海区叠翠路8号");
      return { ok: true, json: async () => ({ status: "1", geocodes: [AMAP_ROAD] }) };
    },
  });
  assert.equal(places[0].name, "叠翠路 · 南海区 · 佛山市");
  assert.match(places[0].detail, /^道路位置，不是门牌/);
  assert.deepEqual(seen, []);
  const url = new URL(buildAmapUrl("佛山市南海区叠翠路", "test-key", "佛山"));
  assert.equal(url.origin + url.pathname, "https://restapi.amap.com/v3/geocode/geo");
  assert.equal(url.searchParams.get("city"), "佛山");
});

const DIECUI_GARDEN = {
  place_id: 238055349,
  lat: "23.0519681",
  lon: "113.1212161",
  name: "叠翠花园",
  display_name: "叠翠花园, 桂城街道, 南海区, 佛山市, 南海区, 广东省, 中国",
  address: {
    residential: "叠翠花园",
    suburb: "桂城街道",
    city: "南海区",
    county: "南海区",
    state: "广东省",
    country: "中国",
    country_code: "cn",
  },
};

test("searchPlaces uses the Nanhai compound when no source has the road", async () => {
  const calls = [];
  const places = await searchPlaces("佛山市南海区叠翠路8号", {
    log: () => {},
    fetchImpl: async (url) => {
      const provider = providerOf(url);
      const asked = queryOf(url);
      calls.push(`${provider}:${asked}`);
      if (provider === "nominatim" && asked === "叠翠 南海 佛山") {
        return { ok: true, json: async () => [DIECUI_GARDEN] };
      }
      return { ok: true, json: async () => [] };
    },
  });
  assert.equal(places[0].name, "叠翠花园 · 桂城街道 · 南海区");
  assert.match(places[0].detail, /^小区位置，不是门牌/);
  assert.equal(places[0].detail.includes("佛山市"), true);
  assert.equal(calls.includes("nominatim:叠翠 南海 佛山"), true);
  assert.equal(calls.some((call) => call.startsWith("nominatim:佛山市南海区叠翠路8号")), true);
});

test("searchPlaces does not call Amap without a key", async () => {
  let amap = false;
  const places = await searchPlaces("佛山市南海区叠翠路8号", {
    log: () => {},
    fetchImpl: async (url) => {
      if (providerOf(url) === "amap") amap = true;
      return { ok: true, json: async () => [] };
    },
  });
  assert.equal(amap, false);
  assert.deepEqual(places, []);
});
