const assert = require("node:assert/strict");
const test = require("node:test");
const { loginItemSettings, loginTarget, shouldApplyLoginItem } = require("../electron/launch");

test("startup uses the portable exe when Windows extracted a temp copy", () => {
  assert.equal(
    loginTarget({ PORTABLE_EXECUTABLE_FILE: "D:\\天气小挂件.exe" }, "C:\\Temp\\app.exe"),
    "D:\\天气小挂件.exe",
  );
  assert.equal(loginTarget({}, "C:\\Temp\\app.exe"), "C:\\Temp\\app.exe");
});

test("login item is off unless enabled, and only Windows applies it", () => {
  assert.equal(loginItemSettings(false, "app.exe").openAtLogin, false);
  assert.equal(loginItemSettings(true, "app.exe").openAtLogin, true);
  assert.equal(loginItemSettings(true, "app.exe").name, "tianqi-widget");
  assert.equal(shouldApplyLoginItem("win32"), true);
  assert.equal(shouldApplyLoginItem("linux"), false);
  assert.equal(shouldApplyLoginItem("darwin"), false);
});
