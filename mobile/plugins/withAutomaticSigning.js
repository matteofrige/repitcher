// Prebuild sets DEVELOPMENT_TEAM (from ios.appleTeamId) but not CODE_SIGN_STYLE,
// so command-line builds can't create the development provisioning profile.
// Force automatic signing on every configuration that has a team.
const { withXcodeProject } = require('expo/config-plugins');

module.exports = function withAutomaticSigning(config) {
  return withXcodeProject(config, (cfg) => {
    const configurations = cfg.modResults.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const buildSettings = configurations[key].buildSettings;
      if (buildSettings && buildSettings.DEVELOPMENT_TEAM) {
        buildSettings.CODE_SIGN_STYLE = 'Automatic';
      }
    }
    return cfg;
  });
};
