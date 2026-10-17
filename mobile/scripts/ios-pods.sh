#!/usr/bin/env bash
# pod install + switch every precompiled framework (React core, Expo xcframeworks) to its
# Debug flavour. A fresh pod install leaves them in Release, and Xcode's Debug device build then
# fails to link or crashes at launch (ExpoViewProps) because the flavour-swap scripts trust a
# stale .last_build_configuration marker.
#
# Usage: bash mobile/scripts/ios-pods.sh   (run again after any `expo prebuild`)
set -euo pipefail
cd "$(dirname "$0")/../ios"
export LANG=en_US.UTF-8
pod install

cd Pods
RN_VERSION=$(node -p "require('../../node_modules/react-native/package.json').version")
printf Release > React-Core-prebuilt/.last_build_configuration
node ../../node_modules/react-native/scripts/replace-rncore-version.js -c Debug -r "$RN_VERSION" -p "$PWD" | tail -1
for a in */artifacts; do
  m=${a%/artifacts}
  [ -f "$a/$m-debug.tar.gz" ] || continue
  printf release > "$a/.last_build_configuration"
  node ../../node_modules/expo-modules-autolinking/scripts/ios/replace-xcframework.js -c debug -m "$m" -x "$PWD/$m" | tail -1
done
echo "Pods pronti (Debug). In Xcode: Product › Clean Build Folder, poi Run."
