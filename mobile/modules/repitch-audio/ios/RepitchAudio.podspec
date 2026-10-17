Pod::Spec.new do |s|
  s.name           = 'RepitchAudio'
  s.version        = '1.0.0'
  s.summary        = 'RePitch native audio engine (AVAudioEngine + Signalsmith Stretch)'
  s.description    = 'Plays local audio files with real-time pitch shifting via Signalsmith Stretch (C++).'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.frameworks = 'AVFoundation', 'AudioToolbox', 'Accelerate', 'MediaPlayer'

  # Signalsmith is header-only and lives in ../cpp/vendor (outside the pod root), so it is
  # reached through the header search path rather than source_files.
  # signalsmith-stretch.h includes "signalsmith-linear/stft.h" => both the stretch dir and
  # the vendor parent dir are needed.
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY' => 'libc++',
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/../cpp/vendor" "$(PODS_TARGET_SRCROOT)/../cpp/vendor/signalsmith-stretch" "$(PODS_TARGET_SRCROOT)/../cpp"',
    'GCC_OPTIMIZATION_LEVEL' => '3',  # DSP too heavy for -O0 even in Debug builds
  }

  s.source_files = "**/*.{h,m,mm,swift}"
  # Only the ObjC header is public (it must stay free of C++ to be part of the Swift umbrella).
  s.public_header_files = "RPPitchAudioUnit.h", "RPTuningDetector.h", "RPMetronome.h", "RPPitchDetectorBridge.h", "RPBeatDetector.h"
end
