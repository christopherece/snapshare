const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

// Expo SDK 52+ auto-detects Bun/npm workspaces, so no manual watchFolders needed.
const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
