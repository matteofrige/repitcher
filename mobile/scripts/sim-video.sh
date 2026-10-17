#!/usr/bin/env bash
# Records App Preview clips of RePitch from the iOS Simulator (real app footage) into
# design/raw/video/<iphone|ipad>[/en]/raw-<scene>.mp4, using the in-app demo mode (src/lib/demo.ts,
# launch arg -RePitchDemo <scene>). Compose them with: node design/video.mjs
#
# Usage:  bash mobile/scripts/sim-video.sh [--no-build]
#   DEVICE_NAME="iPhone 16 Pro Max" (default) | "iPad Pro 13-inch (M4)";  SCREEN_LANG=it|en (default it).
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
OUT="$ROOT/.impeccable/review"
[ "${SCREEN_LANG:-it}" != it ] && OUT="$OUT/${SCREEN_LANG}"
BUILD="$ROOT/ios/build/sim"
BUNDLE_ID="it.re-pitch.repitch"
SCREEN_LANG="${SCREEN_LANG:-it}"
DEVICE_NAME="${DEVICE_NAME:-iPhone 16 Pro Max}"
case "$DEVICE_NAME" in *iPad*) KIND=ipad ;; *) KIND=iphone ;; esac
RAW="$ROOT/design/raw/video/$KIND"; [ "$SCREEN_LANG" != it ] && RAW="$RAW/$SCREEN_LANG"
case "$SCREEN_LANG" in it) LOCALE=it_IT ;; *) LOCALE=en_GB ;; esac
SIM_NAME="RePitch Review"
[ -n "${DEVICE_NAME:-}" ] && SIM_NAME="RePitch Review ($DEVICE_NAME)"
mkdir -p "$OUT" "$RAW"

log() { printf '\n==> %s\n' "$*"; }

# --- simulator -------------------------------------------------------------
log "Simulatore"
RUNTIME=$(xcrun simctl list runtimes -j | /usr/bin/python3 -c '
import json,sys
rs=[r for r in json.load(sys.stdin)["runtimes"] if r["platform"]=="iOS" and r["isAvailable"]]
print(sorted(rs,key=lambda r:[int(x) for x in r["version"].split(".")])[-1]["identifier"] if rs else "")')
if [ -z "$RUNTIME" ]; then
  echo "Nessun runtime iOS installato. Installalo con: xcodebuild -downloadPlatform iOS" >&2
  exit 1
fi
UDID=$(xcrun simctl list devices -j | /usr/bin/python3 -c "
import json,sys
d=json.load(sys.stdin)['devices'].get('$RUNTIME',[])
print(next((x['udid'] for x in d if x['name']=='$SIM_NAME'),''))")
if [ -z "$UDID" ]; then
  TYPE=$(DEVICE_NAME="${DEVICE_NAME:-}" xcrun simctl list devicetypes -j | /usr/bin/python3 -c '
import json,os,sys
names=json.load(sys.stdin)["devicetypes"]
want=os.environ.get("DEVICE_NAME","")
if want:
    ts=[t["identifier"] for t in names if t["name"]==want]
    if not ts:  # newest Pro Max available in the installed runtime
        ts=[t["identifier"] for t in names if "iPhone" in t["name"] and "Pro Max" in t["name"]]
else:
    ts=[t["identifier"] for t in names if "iPhone" in t["name"] and "Pro" in t["name"] and "Max" not in t["name"]]
print(ts[-1])')
  UDID=$(xcrun simctl create "$SIM_NAME" "$TYPE" "$RUNTIME")
fi
echo "UDID $UDID ($RUNTIME)"
# Fresh boot every run: clears system alerts left over from earlier runs.
xcrun simctl shutdown "$UDID" 2>/dev/null || true
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 || true

# The Release build swaps the precompiled React core and Expo xcframeworks inside ios/Pods to
# their release flavour. Xcode's Debug device build then links/crashes against them (stale
# .last_build_configuration markers keep the swap scripts from switching back). Restore debug.
restore_debug_prebuilts() {
  log "Ripristino delle librerie precompilate Debug (per le build da Xcode)"
  (
    cd ios/Pods
    printf Release > React-Core-prebuilt/.last_build_configuration
    node ../../node_modules/react-native/scripts/replace-rncore-version.js \
      -c Debug -r "$(node -p "require('../../node_modules/react-native/package.json').version")" -p "$PWD" | tail -1
    for a in */artifacts; do
      m=${a%/artifacts}
      [ -f "$a/$m-debug.tar.gz" ] || continue
      printf release > "$a/.last_build_configuration"
      node ../../node_modules/expo-modules-autolinking/scripts/ios/replace-xcframework.js -c debug -m "$m" -x "$PWD/$m" | tail -1
    done
  )
}

# --- build -----------------------------------------------------------------
if [ "${1:-}" != "--no-build" ]; then
  log "Build Release per simulatore (da pulito, qualche minuto)"
  # React-Core-prebuilt swaps its Debug/Release flavour inside ios/Pods on every build:
  # objects left from a Debug device build (or vice versa) then fail to link. Always start clean.
  rm -rf "$BUILD"
  # Always restore the Debug prebuilts, even if the build fails or the script is interrupted.
  trap restore_debug_prebuilts EXIT
  xcodebuild -workspace ios/RePitch.xcworkspace -scheme RePitch -configuration Release \
    -sdk iphonesimulator -destination "id=$UDID" -derivedDataPath "$BUILD" \
    ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO build > "$OUT/xcodebuild.log" 2>&1 \
    || { grep -E "error:" "$OUT/xcodebuild.log" | head -30; echo "BUILD FAILED (log: $OUT/xcodebuild.log)"; exit 1; }
  echo "BUILD SUCCEEDED"
  restore_debug_prebuilts
  trap - EXIT
fi
APP=$(find "$BUILD/Build/Products/Release-iphonesimulator" -maxdepth 1 -name '*.app' | head -1)
xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl uninstall "$UDID" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$UDID" "$APP"
# The tuner asks for the microphone: grant it up front, or the system alert covers every capture.
xcrun simctl privacy "$UDID" grant microphone "$BUNDLE_ID" || true

# --- demo data (synthetic: tones, not real recordings) -----------------------
log "Libreria di prova"
DATA=$(xcrun simctl get_app_container "$UDID" "$BUNDLE_ID" data)
DOCS="$DATA/Documents"
mkdir -p "$DOCS/tracks"
tone() { ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=$2:duration=$3" -ac 2 -ar 44100 "$DOCS/tracks/$1"; }
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
cat > "$DOCS/repitch-library.json" <<JSON
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
cat > "$DOCS/repitch-prefs.json" <<JSON
{"onboardingDone":true,"review":{"completedTracks":0,"activeDays":[],"lastPromptAt":null,"lastPromptVersion":null,"lastAnswer":null}}
JSON

# --- recording ---------------------------------------------------------------
xcrun simctl ui "$UDID" appearance light
# record <scene> <route> <seconds>
record() {
  local scene=$1 route=$2 secs=$3 f="$RAW/raw-$1.mp4" args
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
  sleep 1
  rm -f "$f"
  xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$f" >/dev/null 2>&1 &
  local rec=$!
  sleep 1
  args=(-AppleLanguages "($SCREEN_LANG)" -AppleLocale "$LOCALE" -RePitchPortrait 1 -RePitchDemo "$scene")
  [ -n "$route" ] && args+=(-RePitchRoute "$route")
  xcrun simctl launch "$UDID" "$BUNDLE_ID" "${args[@]}" >/dev/null
  sleep "$secs"
  # The encoder drops the last frame(s) of a still screen: force a final screen change (home screen),
  # which the composition step trims away.
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
  sleep 1
  kill -INT "$rec" 2>/dev/null || true
  wait "$rec" 2>/dev/null || true
  sleep 1
  echo "  $f ($(du -h "$f" | cut -f1))"
}

log "Registrazione ($KIND, $SCREEN_LANG)"
record tuning    ""                          10
record library   "/libreria"                 8
record player    "/player?trackId=t4"        10
record metronome "/metronomo"                9
xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
log "Fatto: $RAW"
ls -1 "$RAW"
