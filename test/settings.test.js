const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { glassBackgroundColor, importLegacyKey, normalizeAmapKey, readSettings, writeSettings } = require("../electron/settings");

test("normalizeAmapKey keeps a single token and drops comments", () => {
  assert.equal(normalizeAmapKey("  abc123  \n"), "abc123");
  assert.equal(normalizeAmapKey("# comment\n"), "");
  assert.equal(normalizeAmapKey(""), "");
  assert.equal(normalizeAmapKey(null), "");
});

test("saved key is what search will use after the legacy file was checked once", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "widget-settings-"));
  const file = path.join(directory, "widget-settings.json");
  const imported = importLegacyKey(readSettings(file), "legacy-key");
  writeSettings(file, imported);
  const again = importLegacyKey(readSettings(file), "another-legacy-key");
  assert.equal(again.amapKey, "legacy-key");
  assert.equal(again.legacyChecked, true);

  const cleared = writeSettings(file, { amapKey: "", legacyChecked: true });
  assert.equal(cleared.amapKey, "");
  assert.equal(importLegacyKey(readSettings(file), "legacy-key").amapKey, "");
});

test("writeSettings round-trips the key the widget saved", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "widget-settings-"));
  const file = path.join(directory, "widget-settings.json");
  writeSettings(file, { amapKey: " pasted-key \n", legacyChecked: true });
  assert.deepEqual(readSettings(file), { amapKey: "pasted-key", legacyChecked: true, launchAtLogin: false, glassOpacity: 70 });
});

test("startup stays off until the toggle is saved, and saving it keeps the key", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "widget-settings-"));
  const file = path.join(directory, "widget-settings.json");
  assert.equal(readSettings(file).launchAtLogin, false);
  writeSettings(file, { amapKey: "pasted-key", legacyChecked: true, launchAtLogin: true, glassOpacity: 55 });
  assert.deepEqual(readSettings(file), { amapKey: "pasted-key", legacyChecked: true, launchAtLogin: true, glassOpacity: 55 });
  writeSettings(file, { amapKey: "pasted-key", legacyChecked: true, launchAtLogin: false, glassOpacity: 55 });
  assert.equal(readSettings(file).launchAtLogin, false);
  assert.equal(readSettings(file).glassOpacity, 55);
});

test("glass fill is medium blue and its alpha follows the opacity", () => {
  assert.equal(glassBackgroundColor(70), "#B31F6FE5");
  assert.equal(glassBackgroundColor(100), "#FF1F6FE5");
  assert.equal(glassBackgroundColor(40), "#661F6FE5");
  assert.equal(glassBackgroundColor(12), "#661F6FE5");
});

test("glass opacity defaults to 70 and stays inside 40 to 100", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "widget-settings-"));
  const file = path.join(directory, "widget-settings.json");
  assert.equal(readSettings(file).glassOpacity, 70);
  const low = writeSettings(file, { amapKey: "pasted-key", legacyChecked: true, glassOpacity: 12 });
  assert.equal(low.glassOpacity, 40);
  const high = writeSettings(file, { amapKey: "pasted-key", legacyChecked: true, glassOpacity: 180 });
  assert.equal(high.glassOpacity, 100);
  const kept = importLegacyKey(readSettings(file), "another-legacy-key");
  assert.equal(kept.amapKey, "pasted-key");
  assert.equal(kept.glassOpacity, 100);
});
