function loginTarget(env, execPath) {
  const portable = env && typeof env.PORTABLE_EXECUTABLE_FILE === "string"
    ? env.PORTABLE_EXECUTABLE_FILE.trim()
    : "";
  if (portable) return portable;
  return execPath;
}

function loginItemSettings(enabled, target) {
  return {
    openAtLogin: enabled === true,
    path: target,
    args: [],
    name: "tianqi-widget",
  };
}

function shouldApplyLoginItem(platform) {
  return platform === "win32";
}

module.exports = {
  loginTarget,
  loginItemSettings,
  shouldApplyLoginItem,
};
