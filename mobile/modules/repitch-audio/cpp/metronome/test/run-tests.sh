#!/bin/bash
# Compila l'harness e verifica MetronomeCore (deriva, cambio BPM, accenti).
set -u
export LC_ALL=C
DIR="$(cd "$(dirname "$0")" && pwd)"
T="${TMPDIR:-/tmp}/metronome-test"; mkdir -p "$T"
CXX=/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++
SDK=$(ls -d /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk)
"$CXX" -std=c++17 -O2 -Wall -Wextra -isysroot "$SDK" "$DIR/main.cpp" -o "$T/metronome_test" || exit 1
"$T/metronome_test"
