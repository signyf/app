const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

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

function toPlace(entry) {
  if (!entry || typeof entry !== "object") return null;
  const latitude = Number(entry.lat);
  const longitude = Number(entry.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

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

function parseNominatimResults(payload) {
  const entries = Array.isArray(payload) ? payload : [];
  const places = [];
  const seen = new Set();
  for (const entry of entries) {
    const place = toPlace(entry);
    if (!place) continue;
    const key = `${place.name}|${place.latitude.toFixed(4)}|${place.longitude.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push(place);
    if (places.length >= 8) break;
  }
  return places;
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

async function searchPlaces(query, { fetchImpl = globalThis.fetch, userAgent, signal } = {}) {
  const q = String(query || "").trim().slice(0, 80);
  if (!q) return [];
  const response = await fetchImpl(buildSearchUrl(q), {
    headers: {
      Accept: "application/json",
      "Accept-Language": "zh-CN",
      "User-Agent": userAgent || "tianqi-widget/1.0 (desktop weather widget)",
    },
    signal,
  });
  if (!response.ok) {
    const error = new Error("search failed");
    error.status = response.status;
    throw error;
  }
  return parseNominatimResults(await response.json());
}

module.exports = {
  buildSearchUrl,
  parseNominatimResults,
  searchPlaces,
};
