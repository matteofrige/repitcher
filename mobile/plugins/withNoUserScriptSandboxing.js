// Xcode sandboxes build-phase scripts by default (ENABLE_USER_SCRIPT_SANDBOXING),
// which blocks Expo's "Bundle React Native code and images" phase from writing
// into the .app (e.g. ip.txt). Turn it off for every build configuration.
const { withXcodeProject } = require('expo/config-plugins');

module.exports = function withNoUserScriptSandboxing(config) {
  return withXcodeProject(config, (cfg) => {
    const configurations = cfg.modResults.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const buildSettings = configurations[key].buildSettings;
      if (buildSettings) buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';
    }
    return cfg;
  });
};
