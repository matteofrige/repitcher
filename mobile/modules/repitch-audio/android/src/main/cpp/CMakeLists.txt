cmake_minimum_required(VERSION 3.22.1)
project(repitchaudio CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# This file lives in android/src/main/cpp/, the shared header-only cores in <module>/cpp/
# => four levels up (cpp -> main -> src -> android -> module root).
set(RP_CPP_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../../cpp)

add_library(repitchaudio SHARED repitch_jni.cpp)

# Same include paths as ios/RepitchAudio.podspec.
# signalsmith-stretch.h includes "signalsmith-linear/stft.h" => both the stretch dir and the vendor
# parent dir are needed.
target_include_directories(repitchaudio PRIVATE
  ${RP_CPP_DIR}
  ${RP_CPP_DIR}/vendor
  ${RP_CPP_DIR}/vendor/signalsmith-stretch
)

# DSP is too heavy for -O0 even in Debug builds (same choice as GCC_OPTIMIZATION_LEVEL=3 on iOS).
# No -ffast-math: the iOS build doesn't use it either (and the stretcher relies on NaN checks).
target_compile_options(repitchaudio PRIVATE -O3)

find_library(log-lib log)
target_link_libraries(repitchaudio ${log-lib})
