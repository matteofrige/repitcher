#!/bin/bash
# Compila l'harness e verifica BeatTracker su segnali sintetici.
set -u
export LC_ALL=C
DIR="$(cd "$(dirname "$0")" && pwd)"
T="${TMPDIR:-/tmp}/beats-test"; mkdir -p "$T"
CXX=/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++
SDK=$(ls -d /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk)
"$CXX" -std=c++17 -O2 -isysroot "$SDK" "$DIR/main.cpp" -o "$T/beats_test" || exit 1
fails=0
# nome kind sr minF maxMeanErr(ms; 0 = non controllato)
run() {
  local name=$1 kind=$2 sr=$3 minF=$4 maxErr=$5
  "$T/beats_test" --synth "$kind" "$T/$name.f32" "$sr" 60
  local out; out=$("$T/beats_test" "$T/$name.f32" "$sr" "$T/$name.f32.beats")
  local F err valid ok=1
  F=$(echo "$out" | sed -E 's/.* F=([0-9.]+).*/\1/')
  err=$(echo "$out" | sed -E 's/.*mean_err=([0-9.]+).*/\1/')
  valid=$(echo "$out" | sed -E 's/.*valid=([01]).*/\1/')
  awk -v f="$F" -v m="$minF" 'BEGIN{exit !(f>=m)}' || ok=0
  if [ "$maxErr" != 0 ]; then awk -v e="$err" -v m="$maxErr" 'BEGIN{exit !(e<=m)}' || ok=0; fi
  [ "$valid" = 1 ] || ok=0
  if [ $ok = 1 ]; then s=PASS; else s=FAIL; fails=$((fails+1)); fi
  printf "%-4s %-12s sr=%-6s %s\n" $s "$name" "$sr" "$out"
}
run clicks120 clicks120 44100 0.95 15
run drums     drums     44100 0.95 15
run rall      rall      44100 0.90 0
run accel     accel     44100 0.90 0
run rubato    rubato    44100 0.90 0
run eighths    eighths   44100 0.90 0
run clicks22k clicks120 22050 0.95 15
run rall48k   rall      48000 0.90 0
# noise: deve risultare non valido
"$T/beats_test" --synth noise "$T/noise.f32" 44100 60
out=$("$T/beats_test" "$T/noise.f32" 44100)
if echo "$out" | grep -q 'valid=0'; then s=PASS; else s=FAIL; fails=$((fails+1)); fi
printf "%-4s %-12s sr=%-6s %s\n" $s noise 44100 "$out"
echo "--- Perf: 5 min @44.1k"
"$T/beats_test" --synth rall "$T/p300.f32" 44100 300
"$T/beats_test" "$T/p300.f32" 44100 "$T/p300.f32.beats"
echo "fails=$fails"
[ $fails = 0 ]
