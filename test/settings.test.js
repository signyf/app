const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { importLegacyKey, normalizeAmapKey, readSettings, writeSettings } = require("../electron/settings");

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
  assert.deepEqual(readSettings(file), { amapKey: "pasted-key", legacyChecked: true });
});
