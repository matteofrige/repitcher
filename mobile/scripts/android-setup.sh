#!/usr/bin/env bash
# One-shot Android toolchain for RePitch on Apple Silicon: Android Studio (with its bundled Java),
# command-line tools, SDK 36, NDK/CMake matching React Native 0.86, emulator + a Pixel AVD.
# Accepts the Android SDK licences non-interactively (approved by the owner on 2026-10-15).
# Usage: bash mobile/scripts/android-setup.sh
set -euo pipefail

brew install --cask android-studio android-commandlinetools

export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
mkdir -p "$ANDROID_HOME"
SDKM="$(brew --prefix)/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager"
AVDM="$(brew --prefix)/share/android-commandlinetools/cmdline-tools/latest/bin/avdmanager"

yes | "$SDKM" --sdk_root="$ANDROID_HOME" --licenses >/dev/null
"$SDKM" --sdk_root="$ANDROID_HOME" \
  "platform-tools" "platforms;android-36" "build-tools;36.0.0" "build-tools;35.0.0" \
  "ndk;27.1.12297006" "cmake;3.22.1" "emulator" \
  "system-images;android-36;google_apis;arm64-v8a"

if ! "$AVDM" list avd | grep -q "RePitch_Pixel"; then
  echo no | "$AVDM" create avd -n RePitch_Pixel -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_9 \
    || echo no | "$AVDM" create avd -n RePitch_Pixel -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_7
fi

cat <<MSG

Fatto. Per averle in ogni terminale, aggiungi al tuo ~/.zshrc:
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  export ANDROID_HOME="\$HOME/Library/Android/sdk"
  export PATH="\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/emulator:\$PATH"
Emulatore: \$ANDROID_HOME/emulator/emulator -avd RePitch_Pixel
MSG
