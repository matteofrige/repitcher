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
# softlegato: note morbide legate con decoy piu' forti dei beat. Senza ancoraggi il tracker fallisce
# (e puo' essere non valido: IBI irregolari): e' il caso d'uso dei tap. Qui solo generazione + test sotto.
run clicks22k clicks120 22050 0.95 15
run rall48k   rall      48000 0.90 0
# --- Ancoraggi (tap dell'utente) ---
mkanch() {  # mode(six|four|dense) seed truth -> stdout (jitter +-15 ms)
  awk -v mode=$1 -v seed=$2 'BEGIN{srand(seed)} {t[NR]=$1} END{
    if(mode=="six"){n=0;for(i=1;i<=NR;i++)if(t[i]<20)n++; st=int(n/6); for(k=0;k<6;k++){i=1+k*st; printf "%.4f\n", t[i]+(rand()*2-1)*0.015}}
    else if(mode=="dense"){for(i=1;i<=NR&&t[i]<20;i++) printf "%.4f\n", t[i]+(rand()*2-1)*0.015}
    else {for(i=1;i<=NR;i+=4) printf "%.4f\n", t[i]+(rand()*2-1)*0.015}}' $3
}
getF() { echo "$1" | sed -E 's/.* F=([0-9.]+).*/\1/'; }
getDev() { echo "$1" | sed -E 's/.*anchor_max_dev=([0-9.]+)ms.*/\1/'; }
# rubato + 6 ancoraggi nei primi 20 s: F >= senza ancoraggi, beat sugli ancoraggi entro 20 ms
mkanch six 1 "$T/rubato.f32.beats" > "$T/rubato.anch"
u=$("$T/beats_test" "$T/rubato.f32" 44100 "$T/rubato.f32.beats")
o=$("$T/beats_test" "$T/rubato.f32" 44100 "$T/rubato.f32.beats" --anchors "$T/rubato.anch")
ok=1; awk -v a="$(getF "$o")" -v b="$(getF "$u")" 'BEGIN{exit !(a>=b-1e-9)}' || ok=0
awk -v d="$(getDev "$o")" 'BEGIN{exit !(d<=20)}' || ok=0
if [ $ok = 1 ]; then s=PASS; else s=FAIL; fails=$((fails+1)); fi
printf "%-4s %-12s unanchored F=%s | %s\n" $s rubato+6anch "$(getF "$u")" "$o"
# rubato con tap su ogni battito (tempo locale noto): non deve peggiorare
mkanch dense 3 "$T/rubato.f32.beats" > "$T/rubato.dense"
o=$("$T/beats_test" "$T/rubato.f32" 44100 "$T/rubato.f32.beats" --anchors "$T/rubato.dense")
ok=1; awk -v a="$(getF "$o")" -v b="$(getF "$u")" 'BEGIN{exit !(a>=b-0.02)}' || ok=0
awk -v d="$(getDev "$o")" 'BEGIN{exit !(d<=20)}' || ok=0
if [ $ok = 1 ]; then s=PASS; else s=FAIL; fails=$((fails+1)); fi
printf "%-4s %-12s %s\n" $s rubato+dense "$o"
# softlegato: ancoraggi ogni 4 battiti -> F >= 0.9 (senza ancoraggi e' scarso)
"$T/beats_test" --synth softlegato "$T/softlegato.f32" 44100 60
mkanch four 2 "$T/softlegato.f32.beats" > "$T/softlegato.anch"
u=$("$T/beats_test" "$T/softlegato.f32" 44100 "$T/softlegato.f32.beats")
o=$("$T/beats_test" "$T/softlegato.f32" 44100 "$T/softlegato.f32.beats" --anchors "$T/softlegato.anch")
ok=1; awk -v a="$(getF "$o")" 'BEGIN{exit !(a>=0.9)}' || ok=0
awk -v a="$(getF "$o")" -v b="$(getF "$u")" 'BEGIN{exit !(a>b)}' || ok=0
awk -v d="$(getDev "$o")" 'BEGIN{exit !(d<=20)}' || ok=0
if [ $ok = 1 ]; then s=PASS; else s=FAIL; fails=$((fails+1)); fi
printf "%-4s %-12s unanchored F=%s | %s\n" $s softlegato+4 "$(getF "$u")" "$o"
# noise: deve risultare non valido
"$T/beats_test" --synth noise "$T/noise.f32" 44100 60
out=$("$T/beats_test" "$T/noise.f32" 44100)
if echo "$out" | grep -q 'valid=0'; then s=PASS; else s=FAIL; fails=$((fails+1)); fi
printf "%-4s %-12s sr=%-6s %s\n" $s noise 44100 "$out"
# Audio reale (opzionale, se presente in $TMPDIR/beat-real): tromba adagio valido+incerto, gli altri validi e sicuri
for spec in "tromba:1:1" "the-mountain-royal-baroque:1:0" "minuet-a440:1:0"; do
  IFS=: read n v u <<<"$spec"
  f="${TMPDIR:-/tmp}/beat-real/$n.f32"
  [ -f "$f" ] || continue
  out=$("$T/beats_test" "$f" 44100)
  if echo "$out" | grep -q "valid=$v unc=$u"; then s=PASS; else s=FAIL; fails=$((fails+1)); fi
  printf "%-4s %-12s %s\n" $s "$n" "$out"
done
echo "--- Perf: 5 min @44.1k"
"$T/beats_test" --synth rall "$T/p300.f32" 44100 300
"$T/beats_test" "$T/p300.f32" 44100 "$T/p300.f32.beats"
echo "fails=$fails"
[ $fails = 0 ]
