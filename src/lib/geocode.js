const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const OPEN_METEO_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const PHOTON_ENDPOINT = "https://photon.komoot.io/api/";
const DEFAULT_USER_AGENT = "tianqi-widget/1.2 (desktop weather widget)";
const PROVIDER_TIMEOUT_MS = 5000;

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
  const parts = displayName
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && part !== "中国" && !/^\d{4,}$/.test(part));
  return parts.length ? parts.join(" · ") : fallback;
}

function validLatLon(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90
    && Math.abs(longitude) <= 180;
}

function toPlace(entry) {
  if (!entry || typeof entry !== "object") return null;
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

async function searchPlaces(query, {
  fetchImpl = globalThis.fetch,
  userAgent = DEFAULT_USER_AGENT,
  signal,
  timeoutMs = PROVIDER_TIMEOUT_MS,
  log = console.error,
} = {}) {
  const q = String(query || "").trim().slice(0, 80);
  if (!q) return [];

  let responded = false;
  for (const provider of PROVIDERS) {
    if (signal?.aborted) {
      const error = signal.reason || new DOMException("The operation was aborted", "AbortError");
      logStatus(log, provider.id, error);
      throw error;
    }
    try {
      const places = await requestProvider(provider, q, {
        fetchImpl,
        userAgent,
        signal,
        timeoutMs,
      });
      if (places.length) return places;
      responded = true;
    } catch (error) {
      logStatus(log, provider.id, error);
      if (signal?.aborted) throw error;
    }
  }

  if (responded) return [];
  throw new Error("search failed");
}

module.exports = {
  PROVIDER_TIMEOUT_MS,
  buildOpenMeteoUrl,
  buildPhotonUrl,
  buildSearchUrl,
  parseNominatimResults,
  parseOpenMeteoResults,
  parsePhotonResults,
  searchPlaces,
};
