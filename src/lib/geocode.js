const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const OPEN_METEO_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const PHOTON_ENDPOINT = "https://photon.komoot.io/api/";
const AMAP_ENDPOINT = "https://restapi.amap.com/v3/geocode/geo";
const { normalizeAdcode } = require("./amap-weather");
const DEFAULT_USER_AGENT = "tianqi-widget/1.3 (desktop weather widget)";
const PROVIDER_TIMEOUT_MS = 5000;
const ROAD_NOTE = "道路位置，不是门牌";
const COMPOUND_NOTE = "小区位置，不是门牌";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstText(values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return "";
}

function looselySameCity(primary, candidate) {
  if (!primary || !candidate || !candidate.endsWith("市")) return false;
  return candidate === primary || candidate.startsWith(primary) || primary.startsWith(candidate);
}

function municipalityFromDisplay(displayName) {
  if (typeof displayName !== "string") return "";
  const cities = displayName
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.endsWith("市"));
  return cities.length ? cities[cities.length - 1] : "";
}

function formatPlaceName(entry) {
  const address = entry.address || {};
  const primary = firstText([
    entry.name,
    address.neighbourhood,
    address.quarter,
    address.residential,
    address.suburb,
    address.village,
    address.town,
    address.city,
  ]);
  if (!primary) return fallbackName(entry.display_name);

  const area = firstText([
    address.neighbourhood,
    address.suburb,
    address.city_district,
    address.county,
  ]);
  const region = firstText([
    address.city,
    address.town,
    address.state,
    municipalityFromDisplay(entry.display_name),
  ].filter((candidate) => {
    const text = clean(candidate);
    if (!text || text === primary || text === "中国") return false;
    if (looselySameCity(primary, text)) return false;
    return true;
  }));

  const parts = [];
  for (const part of [primary, area, region]) {
    const text = clean(part);
    if (!text || text === "中国" || parts.includes(text)) continue;
    parts.push(text);
  }
  return parts.join(" · ");
}

function fallbackName(displayName) {
  return formatDetail(displayName, "").split(" · ").slice(0, 3).join(" · ");
}

function formatDetail(displayName, fallback) {
  if (typeof displayName !== "string" || !displayName.trim()) return fallback;
  const parts = [];
  for (const part of displayName.split(",").map((item) => item.trim())) {
    if (!part || part === "中国" || /^\d{4,}$/.test(part) || parts.includes(part)) continue;
    parts.push(part);
  }
  return parts.length ? parts.join(" · ") : fallback;
}

function validLatLon(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90
    && Math.abs(longitude) <= 180;
}

function outsideChina({ code, country, displayName }) {
  const normalized = clean(code).toLowerCase();
  if (normalized && normalized !== "cn" && normalized !== "chn") return true;
  const name = clean(country);
  if (name && name !== "中国") return true;
  if (typeof displayName === "string") {
    const foreign = new Set(["韩国", "日本", "美国", "朝鲜"]);
    const parts = displayName.split(",").map((part) => part.trim());
    if (parts.some((part) => foreign.has(part))) return true;
  }
  return false;
}

function fieldText(value) {
  if (Array.isArray(value)) return "";
  return clean(value);
}

function adminToken(query, suffix) {
  const compact = String(query || "").replace(/\s+/g, "");
  const found = compact.match(new RegExp(`[\\u4e00-\\u9fff]{2,8}${suffix}`, "g")) || [];
  if (!found.length) return "";
  const core = found[found.length - 1].slice(0, -suffix.length);
  return core.replace(/^.*[省市]/, "") || core;
}

function roadToken(query) {
  const compact = String(query || "").replace(/\s+/g, "");
  const found = compact.match(/[\u4e00-\u9fff]{2,8}(?:路|街|巷|胡同|大街)/g) || [];
  if (!found.length) return "";
  return found[found.length - 1].replace(/^.*[市区县镇乡]/, "");
}

function houseToken(query) {
  const match = String(query || "").match(/(?:[0-9０-９]+|[零一二三四五六七八九十百]+)\s*号/);
  return match ? match[0].replace(/\s+/g, "") : "";
}

function expandQueries(query) {
  const variants = [];
  const add = (value) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || variants.includes(text)) return;
    variants.push(text);
  };
  add(query);
  const compact = String(query || "").replace(/\s+/g, "");
  add(compact.replace(/(?:[0-9０-９]+|[零一二三四五六七八九十百]+)\s*号(?:楼|室|铺|栋)?.*$/, ""));
  const road = roadToken(compact);
  if (road) {
    add([road, adminToken(compact, "区"), adminToken(compact, "市")].filter(Boolean).join(" "));
  }
  return variants.slice(0, 4);
}

function relevantPlaces(places, query) {
  const road = roadToken(query);
  const city = adminToken(query, "市");
  const district = adminToken(query, "区");
  return places.filter((place) => {
    const blob = `${place.name}${place.detail}`;
    if (road && !blob.includes(road)) return false;
    if (city && !blob.includes(city)) return false;
    if (district && !blob.includes(district)) return false;
    return true;
  });
}

function stemQuery(query) {
  const road = roadToken(query);
  const stem = road.replace(/(?:路|街|巷|胡同|大街)$/, "");
  if (!stem || stem === road || stem.length < 2) return "";
  return [stem, adminToken(query, "区"), adminToken(query, "市")].filter(Boolean).join(" ");
}

function relevantStem(places, query) {
  const stem = roadToken(query).replace(/(?:路|街|巷|胡同|大街)$/, "");
  const city = adminToken(query, "市");
  const district = adminToken(query, "区");
  return places.filter((place) => {
    const blob = `${place.name}${place.detail}`;
    if (!stem || !blob.includes(stem)) return false;
    if (city && !blob.includes(city)) return false;
    if (district && !blob.includes(district)) return false;
    return true;
  });
}

function labelRoadPin(places, query) {
  const house = houseToken(query);
  const road = roadToken(query);
  if (!house) return places;
  return places.map((place) => {
    if (place.name.includes(house)) return place;
    const blob = `${place.name}${place.detail}`;
    const note = road && blob.includes(road) ? ROAD_NOTE : COMPOUND_NOTE;
    if (place.detail.startsWith(note)) return place;
    return {
      ...place,
      detail: place.detail ? `${note} · ${place.detail}` : note,
    };
  });
}

function toPlace(entry) {
  if (!entry || typeof entry !== "object") return null;
  const address = entry.address || {};
  if (outsideChina({
    code: address.country_code,
    country: address.country,
    displayName: entry.display_name,
  })) return null;
  const latitude = Number(entry.lat);
  const longitude = Number(entry.lon);
  if (!validLatLon(latitude, longitude)) return null;

  const name = formatPlaceName(entry);
  if (!name) return null;
  return {
    id: String(entry.place_id || `${latitude.toFixed(4)},${longitude.toFixed(4)}`),
    name,
    detail: formatDetail(entry.display_name, name),
    latitude,
    longitude,
  };
}

function collectPlaces(entries, convert) {
  const places = [];
  const seen = new Set();
  for (const entry of entries) {
    const place = convert(entry);
    if (!place) continue;
    const key = `${place.name}|${place.latitude.toFixed(4)}|${place.longitude.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push(place);
    if (places.length >= 8) break;
  }
  return places;
}

function parseNominatimResults(payload) {
  return collectPlaces(Array.isArray(payload) ? payload : [], toPlace);
}

function uniqueParts(values, { primary = "", limit = 8 } = {}) {
  const parts = [];
  for (const value of values) {
    const text = clean(value);
    if (!text || text === "中国" || parts.includes(text)) continue;
    if (primary && text !== primary && looselySameCity(primary, text)) continue;
    parts.push(text);
    if (parts.length >= limit) break;
  }
  return parts;
}

function openMeteoToPlace(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (outsideChina({ code: entry.country_code, country: entry.country })) return null;
  const latitude = Number(entry.latitude);
  const longitude = Number(entry.longitude);
  if (!validLatLon(latitude, longitude)) return null;
  const primary = clean(entry.name);
  if (!primary) return null;
  const name = uniqueParts(
    [primary, entry.admin2, entry.admin1, entry.country],
    { primary, limit: 3 },
  ).join(" · ");
  if (!name) return null;
  const detail = uniqueParts(
    [primary, entry.admin3, entry.admin2, entry.admin1, entry.country],
    { primary },
  ).join(" · ");
  return {
    id: String(entry.id || `${latitude.toFixed(4)},${longitude.toFixed(4)}`),
    name,
    detail: detail || name,
    latitude,
    longitude,
  };
}

function parseOpenMeteoResults(payload) {
  const entries = payload && Array.isArray(payload.results) ? payload.results : [];
  return collectPlaces(entries, openMeteoToPlace);
}

function photonToPlace(feature) {
  if (!feature || typeof feature !== "object") return null;
  const coordinates = feature.geometry && feature.geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  if (!validLatLon(latitude, longitude)) return null;
  const props = feature.properties || {};
  if (outsideChina({ code: props.countrycode, country: props.country })) return null;
  const primary = clean(props.name);
  if (!primary) return null;
  const name = uniqueParts(
    [primary, props.district, props.locality, props.city, props.county, props.state],
    { primary, limit: 3 },
  ).join(" · ");
  if (!name) return null;
  const detail = uniqueParts(
    [primary, props.street, props.district, props.locality, props.city, props.county, props.state, props.country],
    { primary },
  ).join(" · ");
  const id = props.osm_id
    ? `${props.osm_type || "osm"}:${props.osm_id}`
    : `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  return {
    id: String(id),
    name,
    detail: detail || name,
    latitude,
    longitude,
  };
}

function parsePhotonResults(payload) {
  const entries = payload && Array.isArray(payload.features) ? payload.features : [];
  return collectPlaces(entries, photonToPlace);
}

function buildSearchUrl(query) {
  const url = new URL(NOMINATIM_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "8");
  url.searchParams.set("accept-language", "zh-CN");
  return url.toString();
}

function buildOpenMeteoUrl(query) {
  const url = new URL(OPEN_METEO_ENDPOINT);
  url.searchParams.set("name", query);
  url.searchParams.set("count", "8");
  url.searchParams.set("language", "zh");
  url.searchParams.set("format", "json");
  return url.toString();
}

function buildPhotonUrl(query) {
  const url = new URL(PHOTON_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");
  return url.toString();
}

function buildAmapUrl(query, key, city) {
  const url = new URL(AMAP_ENDPOINT);
  url.searchParams.set("address", query);
  url.searchParams.set("output", "JSON");
  url.searchParams.set("key", key);
  const bias = clean(city);
  if (bias) url.searchParams.set("city", bias);
  return url.toString();
}

function amapToPlace(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (outsideChina({ country: fieldText(entry.country) || "中国" })) return null;
  const location = fieldText(entry.location);
  const [lonText, latText] = location.split(",");
  const longitude = Number(lonText);
  const latitude = Number(latText);
  if (!validLatLon(latitude, longitude)) return null;
  const street = fieldText(entry.street);
  const number = fieldText(entry.number);
  const district = fieldText(entry.district);
  const city = fieldText(entry.city);
  const province = fieldText(entry.province);
  const formatted = fieldText(entry.formatted_address);
  const level = fieldText(entry.level);
  const doorLevel = level === "门牌号" || level === "门址" || level === "单元号";
  const primary = street ? (doorLevel && number ? `${street}${number}` : street) : "";
  const name = primary
    ? uniqueParts([primary, district, city || province], { primary, limit: 3 }).join(" · ")
    : uniqueParts([formatted, district, city], { limit: 3 }).join(" · ");
  if (!name) return null;
  const detail = uniqueParts([formatted, street, number, district, city, province], { limit: 6 }).join(" · ") || name;
  const place = {
    id: `amap:${location}`,
    name,
    detail,
    latitude,
    longitude,
  };
  const adcode = normalizeAdcode(entry.adcode);
  if (adcode) place.adcode = adcode;
  return place;
}

function parseAmapResults(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  if (String(payload.status) === "0") {
    const error = new Error("search failed");
    error.infocode = String(payload.infocode || "");
    throw error;
  }
  const entries = Array.isArray(payload.geocodes) ? payload.geocodes : [];
  return collectPlaces(entries, amapToPlace);
}

function jsonHeaders(userAgent, language) {
  const headers = {
    Accept: "application/json",
    "User-Agent": userAgent,
  };
  if (language) headers["Accept-Language"] = language;
  return headers;
}

const PROVIDERS = [
  {
    id: "nominatim",
    buildUrl: buildSearchUrl,
    headers: (userAgent) => jsonHeaders(userAgent, "zh-CN"),
    parse: parseNominatimResults,
  },
  {
    id: "open-meteo",
    buildUrl: buildOpenMeteoUrl,
    headers: (userAgent) => jsonHeaders(userAgent, "zh"),
    parse: parseOpenMeteoResults,
  },
  {
    id: "photon",
    buildUrl: buildPhotonUrl,
    headers: (userAgent) => jsonHeaders(userAgent),
    parse: parsePhotonResults,
  },
];

function timeoutError() {
  const error = new Error("timeout");
  error.name = "TimeoutError";
  error.code = "TIMEOUT";
  return error;
}

function describeFailure(error) {
  const seen = new Set();
  let current = error;
  let depth = 0;
  while (current && typeof current === "object" && !seen.has(current) && depth < 8) {
    seen.add(current);
    depth += 1;
    if (typeof current.infocode === "string" && current.infocode) return `amap ${current.infocode}`;
    if (typeof current.status === "number") return `http ${current.status}`;
    const code = current.code;
    if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_NONAME") return "dns";
    if (
      current.name === "TimeoutError"
      || code === "TIMEOUT"
      || code === "ETIMEDOUT"
      || code === "UND_ERR_CONNECT_TIMEOUT"
      || code === "UND_ERR_HEADERS_TIMEOUT"
      || code === "UND_ERR_BODY_TIMEOUT"
    ) return "timeout";
    if (Array.isArray(current.errors)) {
      for (const nested of current.errors) {
        const kind = describeFailure(nested);
        if (kind !== "error") return kind;
      }
    }
    current = current.cause;
  }
  return "error";
}

function logStatus(log, providerId, error) {
  try {
    log(`[geocode] ${providerId}: ${describeFailure(error)}`);
  } catch {
    // A broken logger must not turn a result into a search failure.
  }
}

async function requestProvider(provider, query, { fetchImpl, userAgent, signal, timeoutMs }) {
  const controller = new AbortController();
  const state = { timedOut: false };
  const onParentAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onParentAbort, { once: true });
  }

  let rejectAbort = () => {};
  const abortPromise = new Promise((_, reject) => {
    rejectAbort = reject;
  });
  abortPromise.catch(() => {});
  const onLocalAbort = () => {
    if (signal?.aborted) {
      rejectAbort(signal.reason || new DOMException("The operation was aborted", "AbortError"));
      return;
    }
    rejectAbort(timeoutError());
  };
  if (controller.signal.aborted) onLocalAbort();
  else controller.signal.addEventListener("abort", onLocalAbort, { once: true });

  const timer = setTimeout(() => {
    state.timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    if (signal?.aborted) {
      throw signal.reason || new DOMException("The operation was aborted", "AbortError");
    }
    const response = await Promise.race([
      fetchImpl(provider.buildUrl(query), {
        headers: provider.headers(userAgent),
        signal: controller.signal,
      }),
      abortPromise,
    ]);
    if (!response || response.ok !== true) {
      const error = new Error("search failed");
      error.status = response && typeof response.status === "number" ? response.status : undefined;
      throw error;
    }
    return provider.parse(await response.json());
  } catch (error) {
    if (signal?.aborted) throw error;
    if (state.timedOut || error?.name === "TimeoutError" || error?.code === "TIMEOUT") throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onParentAbort);
    controller.signal.removeEventListener("abort", onLocalAbort);
  }
}

function providersFor(amapKey, city) {
  const providers = [...PROVIDERS];
  const key = clean(amapKey);
  if (!key) return providers;
  providers.push({
    id: "amap",
    buildUrl: (query) => buildAmapUrl(query, key, city),
    headers: (userAgent) => jsonHeaders(userAgent, "zh"),
    parse: parseAmapResults,
  });
  return providers;
}

async function searchPlaces(query, {
  fetchImpl = globalThis.fetch,
  userAgent = DEFAULT_USER_AGENT,
  signal,
  timeoutMs = PROVIDER_TIMEOUT_MS,
  log = console.error,
  amapKey = "",
} = {}) {
  const q = String(query || "").trim().slice(0, 80);
  if (!q) return [];

  const variants = expandQueries(q);
  const providers = providersFor(amapKey, adminToken(q, "市"));
  const dead = new Set();
  let responded = false;
  for (const variant of variants) {
    for (const provider of providers) {
      if (dead.has(provider.id)) continue;
      if (signal?.aborted) {
        const error = signal.reason || new DOMException("The operation was aborted", "AbortError");
        logStatus(log, provider.id, error);
        throw error;
      }
      try {
        const places = labelRoadPin(
          relevantPlaces(await requestProvider(provider, variant, {
            fetchImpl,
            userAgent,
            signal,
            timeoutMs,
          }), q),
          q,
        );
        if (places.length) return places;
        responded = true;
      } catch (error) {
        logStatus(log, provider.id, error);
        dead.add(provider.id);
        if (signal?.aborted) throw error;
      }
    }
  }

  const stem = stemQuery(q);
  if (stem) {
    for (const provider of providers) {
      if (dead.has(provider.id)) continue;
      if (signal?.aborted) {
        const error = signal.reason || new DOMException("The operation was aborted", "AbortError");
        logStatus(log, provider.id, error);
        throw error;
      }
      try {
        const places = labelRoadPin(
          relevantStem(await requestProvider(provider, stem, {
            fetchImpl,
            userAgent,
            signal,
            timeoutMs,
          }), q),
          q,
        );
        if (places.length) return places;
        responded = true;
      } catch (error) {
        logStatus(log, provider.id, error);
        dead.add(provider.id);
        if (signal?.aborted) throw error;
      }
    }
  }

  if (responded) return [];
  throw new Error("search failed");
}

module.exports = {
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
};
