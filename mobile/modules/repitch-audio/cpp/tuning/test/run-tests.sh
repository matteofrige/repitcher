#!/bin/bash
# Compila l'harness e verifica TuningEstimator su segnali sintetici.
set -u
export LC_ALL=C
DIR="$(cd "$(dirname "$0")" && pwd)"
T="${TMPDIR:-/tmp}/tuning-test"; mkdir -p "$T"
CXX=/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++
SDK=$(ls -d /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk)
"$CXX" -std=c++17 -O2 -isysroot "$SDK" "$DIR/main.cpp" -o "$T/tuning_test" || exit 1
pass=0; fail=0
# nome kind A tolleranza(cents)
run() {
  local name=$1 kind=$2 A=$3 tol=$4
  "$T/tuning_test" --synth "$kind" "$A" "$T/$name.f32" 44100 60
  local out; out=$("$T/tuning_test" "$T/$name.f32" 44100)
  local cents valid
  cents=$(echo "$out" | sed -E 's/.*cents=([-0-9.]+).*/\1/')
  valid=$(echo "$out" | sed -E 's/.*valid=([01]).*/\1/')
  local exp; exp=$(awk -v a="$A" 'BEGIN{c=1200*log(a/440)/log(2); c=c-100*int(c/100+(c<0?-0.5:0.5)); printf "%.2f",c}')
  local err; err=$(awk -v c="$cents" -v e="$exp" 'BEGIN{d=c-e; if(d<0)d=-d; printf "%.2f",d}')
  local ok=0
  if [ "$kind" = pink ]; then [ "$valid" = 0 ] && ok=1
  else awk -v e="$err" -v t="$tol" 'BEGIN{exit !(e<=t)}' && [ "$valid" = 1 ] && ok=1; fi
  if [ $ok = 1 ]; then pass=$((pass+1)); s=PASS; else fail=$((fail+1)); s=FAIL; fi
  printf "%-4s %-14s A=%-4s atteso=%7s ctt  %s\n" $s "$name" "$A" "$exp" "$out"
}
run melody432   melody   432 2
run melody442   melody   442 2
run melody440   melody   440 2
run melody415   melody   415 2
run chords435   chords   435 2
run vibrato438  vibrato  438 5
run pink        pink     440 0
run melnoise432 melnoise 432 5
echo "--- Perf: 90 s @44.1k"
"$T/tuning_test" --synth melody 432 "$T/p90.f32" 44100 90
"$T/tuning_test" "$T/p90.f32" 44100
echo "pass=$pass fail=$fail"
[ $fail = 0 ]
