const fs = require("fs");
const path = require("path");

function normalizeAmapKey(value) {
  if (typeof value !== "string") return "";
  const line = value.split(/\r?\n/).map((item) => item.trim()).find(Boolean) || "";
  if (!line || line.startsWith("#")) return "";
  return line;
}

const GLASS_MIN = 40;
const GLASS_MAX = 100;
const GLASS_DEFAULT = 70;

function normalizeGlassOpacity(value) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return GLASS_DEFAULT;
  return Math.min(GLASS_MAX, Math.max(GLASS_MIN, Math.round(number)));
}

function emptySettings() {
  return { amapKey: "", legacyChecked: false, launchAtLogin: false, glassOpacity: GLASS_DEFAULT };
}

function readSettings(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!data || typeof data !== "object") return emptySettings();
    return {
      amapKey: normalizeAmapKey(data.amapKey),
      legacyChecked: data.legacyChecked === true,
      launchAtLogin: data.launchAtLogin === true,
      glassOpacity: normalizeGlassOpacity(data.glassOpacity),
    };
  } catch {
    return emptySettings();
  }
}

function writeSettings(filePath, settings) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const next = {
    amapKey: normalizeAmapKey(settings && settings.amapKey),
    legacyChecked: Boolean(settings && settings.legacyChecked),
    launchAtLogin: Boolean(settings && settings.launchAtLogin),
    glassOpacity: normalizeGlassOpacity(settings && settings.glassOpacity),
  };
  const tmp = path.join(directory, `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.copyFileSync(tmp, filePath);
  fs.rmSync(tmp, { force: true });
  return next;
}

function importLegacyKey(settings, legacyText) {
  const current = settings && typeof settings === "object" ? settings : emptySettings();
  const launchAtLogin = current.launchAtLogin === true;
  const glassOpacity = normalizeGlassOpacity(current.glassOpacity);
  if (current.legacyChecked) {
    return {
      amapKey: normalizeAmapKey(current.amapKey),
      legacyChecked: true,
      launchAtLogin,
      glassOpacity,
    };
  }
  return {
    amapKey: normalizeAmapKey(current.amapKey) || normalizeAmapKey(legacyText),
    legacyChecked: true,
    launchAtLogin,
    glassOpacity,
  };
}

module.exports = {
  normalizeAmapKey,
  normalizeGlassOpacity,
  readSettings,
  writeSettings,
  importLegacyKey,
};
