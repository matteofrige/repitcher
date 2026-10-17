#!/usr/bin/env bash
# Builds RePitch (Release APK, no Metro needed) for an Android emulator, seeds a demo
# library (synthetic tones + playlists), and captures the main screens in light and dark
# into .impeccable/review/android/.
#
# Usage (from anywhere):  AVD=RePitch_Pixel SCREEN_LANG=it bash mobile/scripts/emu-screens.sh [--no-build]
#   AVD=RePitch_Tablet -> tablet captures (folder "tablet"); anything else -> "phone".
#   SCREEN_LANG=en     -> app in English (default: it). English captures go to a /en subfolder.
#   Light captures are also copied to design/raw/android/<phone|tablet>[/en]/{intonazione,libreria,player,
#   playlist,metronomo}.png (input of DEVICE_STORE=android|android-tablet node design/store.mjs).
# Needs: Android Studio JBR, Android SDK, ffmpeg. Run adb/gradle/emulator outside any sandbox.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
AVD="${AVD:-RePitch_Pixel}"
SCREEN_LANG="${SCREEN_LANG:-it}"
PKG="it.repitch.RePitch"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export JAVA_TOOL_OPTIONS="--enable-native-access=ALL-UNNAMED"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

KIND=phone
case "$AVD" in *[Tt]ablet*) KIND=tablet ;; esac
SUB="$KIND"; [ "$SCREEN_LANG" != it ] && SUB="$KIND/$SCREEN_LANG"
OUT="$ROOT/.impeccable/review/android/$SUB"
RAW="$ROOT/design/raw/android/$SUB"
case "$SCREEN_LANG" in it) LOCALE=it-IT ;; *) LOCALE=en-GB ;; esac
mkdir -p "$OUT" "$RAW"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

log() { printf '\n==> %s\n' "$*"; }

# --- emulator ----------------------------------------------------------------
log "Emulatore $AVD"
# Always a cold boot: a second run on the same emulator session left the demo library unread (guide on screen).
if adb devices | grep -q '^emulator-.*device$'; then adb emu kill >/dev/null || true; sleep 8; fi
"$ANDROID_HOME/emulator/emulator" -avd "$AVD" -no-snapshot-save -no-boot-anim > "$TMP/emulator.log" 2>&1 &
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 2; done
adb root >/dev/null || true; sleep 3; adb wait-for-device
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard || true
# No animations: captures never land mid-transition.
for k in window_animation_scale transition_animation_scale animator_duration_scale; do adb shell settings put global $k 0; done
# Portrait for every device (long side vertical): the tablet is landscape at rotation 0, so it needs 1.
ROT=0; [ "$KIND" = tablet ] && ROT=${TABLET_ROTATION:-1}
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation "$ROT"
# Clean status bar: 9:41, full battery, wifi.
adb shell settings put global sysui_demo_allowed 1
demo() { adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }
demo enter
demo clock -e hhmm 0941
demo battery -e level 100 -e plugged false
demo network -e wifi show -e level 4 -e fully true
demo network -e mobile hide
demo notifications -e visible false

# --- build -------------------------------------------------------------------
APKDIR="$ROOT/android/app/build/outputs/apk/release"
if [ "${1:-}" != "--no-build" ]; then
  log "Build Release (arm64, qualche minuto)"
  [ -f android/local.properties ] || echo "sdk.dir=$ANDROID_HOME" > android/local.properties
  (cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a -q)
fi
APK=$(ls -t "$APKDIR"/*.apk | head -1)
adb uninstall "$PKG" >/dev/null 2>&1 || true
adb install -r "$APK" >/dev/null
# The tuner asks for the microphone: grant it up front, or the system dialog covers every capture.
adb shell pm grant "$PKG" android.permission.RECORD_AUDIO || true
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true
adb shell cmd locale set-app-locales "$PKG" --locales "$LOCALE" || true

# --- demo data (synthetic: tones, not real recordings) -------------------------
log "Libreria di prova"
DOCS="/data/data/$PKG/files"
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null   # first launch creates the app data dir
sleep 6; adb shell am force-stop "$PKG"; sleep 1
adb shell mkdir -p "$DOCS/tracks"
tone() { ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=$2:duration=$3" -ac 2 -ar 44100 "$TMP/$1"; adb push "$TMP/$1" "$DOCS/tracks/$1" >/dev/null; }
tone t1.m4a 440 214
tone t2.m4a 392 187
tone t3.m4a 523 251
tone t4.m4a 330 162
tone t5.m4a 294 305
NOW=$(date +%s)000
# Demo titles in the capture language.
TT0="Aria sulla quarta corda — base per violino"; [ "$SCREEN_LANG" = it ] || TT0="Air on the G String — violin backing"
TT1="Ave verum corpus — prova contralti"; [ "$SCREEN_LANG" = it ] || TT1="Ave verum corpus — alto rehearsal"
TT2="La primavera, Allegro"; [ "$SCREEN_LANG" = it ] || TT2="Spring, Allegro"
TT3="Esercizio: scale maggiori a due ottave"; [ "$SCREEN_LANG" = it ] || TT3="Exercise: two-octave major scales"
TT4="Prove di coro — giovedì"; [ "$SCREEN_LANG" = it ] || TT4="Choir rehearsal — Thursday"
TT5="Lezione di violino"; [ "$SCREEN_LANG" = it ] || TT5="Violin lesson"
cat > "$TMP/repitch-library.json" <<JSON
{"version":3,"installedAsFree":true,
"globalTuning":{"semitones":3,"cents":0,"refHz":442},
"tracks":[
{"id":"t1","fileName":"t1.m4a","title":"$TT0","duration":214,"addedAt":$NOW,"override":null,"detectedHz":432,"detectedConfidence":0.82,"detection":"done","sourceHz":null},
{"id":"t2","fileName":"t2.m4a","title":"$TT1","duration":187,"addedAt":$NOW,"override":{"semitones":-2,"cents":0},"detectedHz":442,"detectedConfidence":0.7,"detection":"done","sourceHz":null},
{"id":"t3","fileName":"t3.m4a","title":"$TT2","duration":251,"addedAt":$NOW,"override":null,"detectedHz":440,"detectedConfidence":0.9,"detection":"done","sourceHz":null},
{"id":"t4","fileName":"t4.m4a","title":"Scarborough Fair","duration":162,"addedAt":$NOW,"override":{"semitones":3,"cents":-12},"detectedHz":432,"detectedConfidence":0.4,"detection":"done","sourceHz":null},
{"id":"t5","fileName":"t5.m4a","title":"$TT3","duration":305,"addedAt":$NOW,"override":null,"detectedHz":null,"detectedConfidence":null,"detection":"failed","sourceHz":null}],
"playlists":[
{"id":"p1","name":"$TT4","trackIds":["t2","t4","t3"],"createdAt":$NOW},
{"id":"p2","name":"$TT5","trackIds":["t1","t5"],"createdAt":$NOW}]}
JSON
# Guide already seen, rating prompt out of reach: clean captures.
cat > "$TMP/repitch-prefs.json" <<JSON
{"onboardingDone":true,"review":{"completedTracks":0,"activeDays":[],"lastPromptAt":null,"lastPromptVersion":null,"lastAnswer":null}}
JSON
adb push "$TMP/repitch-library.json" "$DOCS/repitch-library.json" >/dev/null
adb push "$TMP/repitch-prefs.json" "$DOCS/repitch-prefs.json" >/dev/null
adb shell chown -R "$(adb shell stat -c %u:%g /data/data/$PKG | tr -d '\r')" "$DOCS"

# Sanity check: the seeded library must show up (a first-launch race can leave the guide on screen).
for try in 1 2 3; do
  adb shell am force-stop "$PKG"
  adb shell am start -W -a android.intent.action.VIEW -d "repitch:///libreria" "$PKG" >/dev/null
  sleep 5
  adb exec-out uiautomator dump /dev/tty 2>/dev/null | grep -q "Scarborough" && break
  echo "  libreria demo non visibile (tentativo $try): riscrivo i dati"
  adb shell am force-stop "$PKG"; sleep 1
  adb push "$TMP/repitch-library.json" "$DOCS/repitch-library.json" >/dev/null
  adb push "$TMP/repitch-prefs.json" "$DOCS/repitch-prefs.json" >/dev/null
  adb shell chown -R "$(adb shell stat -c %u:%g /data/data/$PKG | tr -d '\r')" "$DOCS"
done

# --- captures ----------------------------------------------------------------
shot() { sleep "${2:-2.5}"; adb exec-out screencap -p > "$OUT/$1.png"; echo "  $1.png"; }
# Light captures are also copied to design/raw/android/ with fixed names.
raw() { [ "$suffix" = light ] && cp "$OUT/$1.png" "$RAW/$2.png"; return 0; }
# Launches the app fresh on a route via deep link. Empty route = initial tab (Intonazione).
launch_route() {
  adb shell am force-stop "$PKG"
  if [ -n "${1:-}" ]; then
    adb shell am start -W -a android.intent.action.VIEW -d "repitch://$1" "$PKG" >/dev/null
  else
    adb shell am start -W -n "$PKG/.MainActivity" >/dev/null
  fi
}

capture_set() {
  local suffix=$1 P="android-$KIND"
  launch_route "";                   shot "$P-intonazione-tab-$suffix" 4; raw "$P-intonazione-tab-$suffix" intonazione
  launch_route "/libreria";          shot "$P-libreria-$suffix" 4; raw "$P-libreria-$suffix" libreria
  launch_route "/metronomo";         shot "$P-metronomo-$suffix" 4; raw "$P-metronomo-$suffix" metronomo
  launch_route "/accordatore";       shot "$P-accordatore-$suffix" 4
  launch_route "/playlist/p1";       shot "$P-playlist-dettaglio-$suffix" 4; raw "$P-playlist-dettaglio-$suffix" playlist
  launch_route "/player?trackId=t4"; shot "$P-player-$suffix" 4.5; raw "$P-player-$suffix" player
}

log "Screenshot (chiaro)"
adb shell cmd uimode night no
capture_set light
log "Screenshot (scuro)"
adb shell cmd uimode night yes
capture_set dark
adb shell cmd uimode night no

adb shell settings put system user_rotation 0
demo exit
log "Fatto: $OUT"
ls -1 "$OUT"/*.png
