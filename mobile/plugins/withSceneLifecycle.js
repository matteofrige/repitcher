// The iOS 27 SDK refuses to launch apps that don't adopt the UIScene life cycle.
// Expo ships ExpoAppSceneDelegate for this, but the prebuild template still uses the
// app-delegate window. This plugin:
//  - registers EXExpoAppSceneDelegate in Info.plist (UIApplicationSceneManifest);
//  - makes AppDelegate conform to ExpoReactNativeFactoryProvider;
//  - removes the window creation from didFinishLaunching (the scene delegate does it).
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });
}

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('withSceneLifecycle: only Swift AppDelegate is supported');
    }
    let src = cfg.modResults.contents;

    if (!src.includes('ExpoReactNativeFactoryProvider')) {
      src = src.replace(
        /class AppDelegate: ExpoAppDelegate \{/,
        'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {'
      );
    }

    // Drop the app-delegate window + startReactNative block.
    src = src.replace(
      /#if os\(iOS\) \|\| os\(tvOS\)\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*factory\.startReactNative\([\s\S]*?\)\s*#endif\s*/,
      '// Window and React Native start-up are handled by ExpoAppSceneDelegate (UIScene life cycle).\n\n    '
    );

    if (!src.includes('ExpoReactNativeFactoryProvider') || src.includes('UIScreen.main.bounds')) {
      throw new Error('withSceneLifecycle: AppDelegate template changed, update the plugin');
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withSceneLifecycle(config) {
  return withSceneAppDelegate(withSceneManifest(config));
};
