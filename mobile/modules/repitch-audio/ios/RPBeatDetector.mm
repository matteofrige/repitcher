#import "RPBeatDetector.h"

#import <AVFoundation/AVFoundation.h>
#import <CommonCrypto/CommonDigest.h>
#import <CoreML/CoreML.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <mutex>
#include <vector>

#include "beats/BeatThisFrontend.hpp"
#include "beats/BeatTracker.hpp"

using repitch::BeatThisChunking;
using repitch::BeatThisFrontend;

namespace {

constexpr AVAudioFrameCount kDecodeChunk = 32768;
constexpr double kNeuralFps = (double)BeatThisFrontend::kSampleRate / (double)BeatThisFrontend::kHop;  // 50

// ---- Activation cache -------------------------------------------------------------------------------------

struct Activation {
  std::vector<float> beat, down;
  double fps = kNeuralFps;
};

struct CacheHeader {
  uint32_t magic;    // 'RPBA'
  uint32_t version;
  uint32_t frames;
  float fps;
};
constexpr uint32_t kCacheMagic = 0x41425052u, kCacheVersion = 1;

NSString *CachePath(NSURL *url) {
  NSString *path = url.path;
  NSDictionary *attrs = [[NSFileManager defaultManager] attributesOfItemAtPath:path error:nil];
  if (!attrs) return nil;
  NSString *key = [NSString stringWithFormat:@"%@|%llu|%.3f", path, (unsigned long long)[attrs fileSize],
                   [[attrs fileModificationDate] timeIntervalSince1970]];
  const char *c = key.UTF8String;
  unsigned char md[CC_SHA1_DIGEST_LENGTH];
  CC_SHA1(c, (CC_LONG)strlen(c), md);
  NSMutableString *hex = [NSMutableString stringWithCapacity:40];
  for (int i = 0; i < CC_SHA1_DIGEST_LENGTH; i++) [hex appendFormat:@"%02x", md[i]];
  NSURL *caches = [[NSFileManager defaultManager] URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject;
  if (!caches) return nil;
  NSURL *dir = [caches URLByAppendingPathComponent:@"RePitchBeats" isDirectory:YES];
  [[NSFileManager defaultManager] createDirectoryAtURL:dir withIntermediateDirectories:YES attributes:nil error:nil];
  return [[dir URLByAppendingPathComponent:[hex stringByAppendingString:@".bin"]] path];
}

bool LoadActivation(NSURL *url, Activation &act) {
  NSString *p = CachePath(url);
  if (!p) return false;
  NSData *d = [NSData dataWithContentsOfFile:p options:NSDataReadingMappedIfSafe error:nil];
  if (!d || d.length < sizeof(CacheHeader)) return false;
  CacheHeader h;
  memcpy(&h, d.bytes, sizeof h);
  if (h.magic != kCacheMagic || h.version != kCacheVersion || h.frames == 0 || !(h.fps >= 10)) return false;
  if (d.length != sizeof h + 2 * sizeof(float) * (size_t)h.frames) return false;
  const float *f = (const float *)((const char *)d.bytes + sizeof h);
  act.beat.assign(f, f + h.frames);
  act.down.assign(f + h.frames, f + 2 * (size_t)h.frames);
  act.fps = h.fps;
  return true;
}

void SaveActivation(NSURL *url, const Activation &act) {
  NSString *p = CachePath(url);
  if (!p) return;
  CacheHeader h{kCacheMagic, kCacheVersion, (uint32_t)act.beat.size(), (float)act.fps};
  NSMutableData *d = [NSMutableData dataWithBytes:&h length:sizeof h];
  [d appendBytes:act.beat.data() length:act.beat.size() * sizeof(float)];
  [d appendBytes:act.down.data() length:act.down.size() * sizeof(float)];
  [d writeToFile:p options:NSDataWritingAtomic error:nil];
}

// ---- Core ML model ----------------------------------------------------------------------------------------

std::mutex gModelMutex;
MLModel *gModel = nil;
bool gModelCpuOnly = false;
bool gModelBroken = false;

NSURL *ModelURL() {
  NSBundle *host = [NSBundle bundleForClass:[RPBeatDetector class]];
  for (NSBundle *b in @[host, [NSBundle mainBundle]]) {
    NSURL *bundleURL = [b URLForResource:@"RepitchAudioModels" withExtension:@"bundle"];
    NSBundle *res = bundleURL ? [NSBundle bundleWithURL:bundleURL] : nil;
    NSURL *m = [res URLForResource:@"BeatThis" withExtension:@"mlmodelc"];
    if (m) return m;
  }
  return nil;
}

// Caller holds gModelMutex.
MLModel *LoadModel(bool cpuOnly) {
  NSURL *url = ModelURL();
  if (!url) {
    NSLog(@"[RPBeatDetector] BeatThis.mlmodelc not found in bundle");
    return nil;
  }
  MLModelConfiguration *cfg = [[MLModelConfiguration alloc] init];
  // FP32 net: the ANE won't take it and falls back to GPU/CPU. Never restrict to CPU+ANE only.
  cfg.computeUnits = cpuOnly ? MLComputeUnitsCPUOnly : MLComputeUnitsAll;
  NSError *err = nil;
  MLModel *m = [MLModel modelWithContentsOfURL:url configuration:cfg error:&err];
  if (!m) NSLog(@"[RPBeatDetector] model load failed: %@", err);
  return m;
}

// Runs the network over the whole spectrogram (frames x 128). Returns false if the model can't run.
bool RunNetwork(const std::vector<float> &spec, long long frames, Activation &act) {
  const int bins = BeatThisFrontend::kMels;
  const auto chunks = BeatThisChunking::split(frames);
  if (chunks.empty()) return false;
  const NSInteger kLen = (NSInteger)BeatThisChunking::kChunk;

  std::vector<std::vector<float>> beatOuts(chunks.size()), downOuts(chunks.size());
  bool retriedCpu = false;
  for (size_t q = 0; q < chunks.size(); q++) {
    const auto &c = chunks[q];
    bool done = false;
    while (!done) {
      MLModel *model = nil;
      {
        std::lock_guard<std::mutex> lock(gModelMutex);
        if (gModelBroken) return false;
        if (!gModel) gModel = LoadModel(gModelCpuOnly);
        if (!gModel) { gModelBroken = true; return false; }
        model = gModel;
      }
      @autoreleasepool {
        NSError *err = nil;
        MLMultiArray *in = [[MLMultiArray alloc] initWithShape:@[@1, @(kLen), @(bins)]
                                                      dataType:MLMultiArrayDataTypeFloat32 error:&err];
        if (!in) { NSLog(@"[RPBeatDetector] MLMultiArray: %@", err); return false; }
        if (in.strides.count != 3 || in.strides[2].integerValue != 1 || in.strides[1].integerValue != bins) {
          NSLog(@"[RPBeatDetector] unexpected input strides %@", in.strides);
          std::lock_guard<std::mutex> lock(gModelMutex);
          gModelBroken = true;
          return false;
        }
        float *dst = (float *)in.dataPointer;
        // The network input is fixed at 1500 frames; fill() writes the chunk (with beat_this's padding), the rest is zero.
        std::fill(dst, dst + (size_t)kLen * bins, 0.f);
        BeatThisChunking::fill(c, spec.data(), bins, dst);  // strides: [1500*128, 128, 1] (contiguous)
        MLDictionaryFeatureProvider *fp = [[MLDictionaryFeatureProvider alloc] initWithDictionary:@{@"spect": in} error:&err];
        id<MLFeatureProvider> out = fp ? [model predictionFromFeatures:fp error:&err] : nil;
        MLMultiArray *b = [out featureValueForName:@"beat"].multiArrayValue;
        MLMultiArray *d = [out featureValueForName:@"downbeat"].multiArrayValue;
        if (!out || !b || !d || b.count < c.length() || d.count < c.length()) {
          NSLog(@"[RPBeatDetector] prediction failed: %@", err);
          std::lock_guard<std::mutex> lock(gModelMutex);
          if (!gModelCpuOnly && !retriedCpu) {  // one retry on CPU, restarting this chunk
            retriedCpu = true;
            gModelCpuOnly = true;
            gModel = nil;
            continue;
          }
          gModelBroken = true;
          return false;
        }
        const size_t n = (size_t)c.length();
        auto copyOut = [&](MLMultiArray *a, std::vector<float> &v) {
          v.resize(n);
          if (a.dataType == MLMultiArrayDataTypeFloat32) {
            memcpy(v.data(), a.dataPointer, n * sizeof(float));
          } else {
            for (size_t i = 0; i < n; i++) v[i] = [a objectAtIndexedSubscript:(NSInteger)i].floatValue;
          }
        };
        copyOut(b, beatOuts[q]);
        copyOut(d, downOuts[q]);
        done = true;
      }
    }
  }
  act.beat = BeatThisChunking::stitch(chunks, beatOuts, frames);
  act.down = BeatThisChunking::stitch(chunks, downOuts, frames);
  // Frames the stitching never covers stay at -1000: they are probabilities here, so clamp to 0.
  for (auto &v : act.beat) if (!(v >= 0.f)) v = 0.f;
  for (auto &v : act.down) if (!(v >= 0.f)) v = 0.f;
  act.fps = kNeuralFps;
  return true;
}

// ---- File decoding ----------------------------------------------------------------------------------------

// Streams the file as mono chunks to `sink(const float*, size_t)`. Returns 0 on success, 1 on read error (error set),
// -1 if the file is empty/unsupported.
template <typename Sink>
int DecodeMono(AVAudioFile *file, double &sampleRate, NSError **error, Sink sink) {
  AVAudioFormat *format = file.processingFormat;
  sampleRate = format.sampleRate;
  const AVAudioFrameCount channels = format.channelCount;
  if (sampleRate <= 0 || file.length <= 0 || channels == 0) return -1;
  AVAudioPCMBuffer *buffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:kDecodeChunk];
  if (!buffer) return 1;
  std::vector<float> mono(kDecodeChunk);
  AVAudioFramePosition remaining = file.length;
  while (remaining > 0) {
    @autoreleasepool {
      const AVAudioFrameCount want = (AVAudioFrameCount)std::min<AVAudioFramePosition>(remaining, kDecodeChunk);
      NSError *readError = nil;
      if (![file readIntoBuffer:buffer frameCount:want error:&readError]) {
        if (error) *error = readError;
        remaining = -1;
        continue;
      }
      const AVAudioFrameCount got = buffer.frameLength;
      const float *const *data = buffer.floatChannelData;
      if (got == 0 || !data) { remaining = 0; continue; }
      for (AVAudioFrameCount i = 0; i < got; i++) {
        float sum = 0.f;
        for (AVAudioFrameCount ch = 0; ch < channels; ch++) sum += data[ch][i];
        mono[i] = sum / (float)channels;
      }
      sink(mono.data(), (size_t)got);
      remaining -= got;
    }
  }
  return remaining < 0 ? 1 : 0;
}

std::vector<double> CleanTimes(NSArray<NSNumber *> *a) {
  std::vector<double> v;
  for (NSNumber *n in a) {
    const double t = n.doubleValue;
    if (std::isfinite(t) && t >= 0) v.push_back(t);
  }
  return v;
}

NSArray<NSNumber *> *BeatsArray(const std::vector<double> &beats) {
  NSMutableArray<NSNumber *> *out = [NSMutableArray arrayWithCapacity:beats.size()];
  for (double t : beats) [out addObject:@(std::round(t * 10000.0) / 10000.0)];
  return out;
}

NSDictionary<NSString *, id> *ResultDict(const repitch::BeatTrackerResult &res, NSString *method, int phase, float margin) {
  return @{
    @"valid": @(res.valid),
    @"uncertain": @(res.uncertain),
    @"bpm": @(res.medianBpm),
    @"confidence": @((double)res.confidence),
    @"beats": BeatsArray(res.beats),
    @"method": method,
    @"downbeatIndex": @(phase),
    @"downbeatMargin": @((double)margin),
  };
}

// Neural path. Returns nil if the network could not run (caller falls back); sets *hardError for unreadable files.
NSDictionary<NSString *, id> *DetectNeural(NSURL *url, AVAudioFile *file, const std::vector<double> &anchors,
                                           NSInteger beatsPerBar, BOOL *hardError, NSError **error) {
  Activation act;
  if (!LoadActivation(url, act)) {
    {
      std::lock_guard<std::mutex> lock(gModelMutex);
      if (gModelBroken) return nil;
    }
    BeatThisFrontend fe;
    double sr = 0;
    bool started = false;
    const int rc = DecodeMono(file, sr, error, [&](const float *x, size_t n) {
      if (!started) { started = fe.begin(sr); }
      if (started) fe.push(x, n);
    });
    if (rc == 1) { *hardError = YES; return nil; }
    if (rc != 0 || !started) return nil;
    std::vector<float> spec = fe.finish();
    const long long frames = (long long)(spec.size() / BeatThisFrontend::kMels);
    if (frames < 100) return nil;
    if (!RunNetwork(spec, frames, act)) return nil;
    SaveActivation(url, act);
  }
  repitch::BeatTracker tracker;
  tracker.setAnchors(anchors);
  const repitch::BeatTrackerResult res = tracker.analyzeActivation(act.beat.data(), act.beat.size(), act.fps, act.down.data());
  float margin = 0.f;
  const int phase = repitch::BeatTracker::downbeatPhase(res.beats, act.down.data(), act.down.size(), act.fps, (int)std::max<NSInteger>(beatsPerBar, 2), &margin);
  return ResultDict(res, @"neural", phase, margin);
}

NSDictionary<NSString *, id> *DetectSpectral(NSURL *url, const std::vector<double> &anchors, NSError **error) {
  AVAudioFile *file = [[AVAudioFile alloc] initForReading:url error:error];
  if (!file) return nil;
  repitch::BeatTracker tracker;
  tracker.setAnchors(anchors);
  double sr = 0;
  bool started = false;
  const int rc = DecodeMono(file, sr, error, [&](const float *x, size_t n) {
    if (!started) { tracker.begin(sr); started = true; }
    tracker.push(x, n);
  });
  if (rc == 1) return nil;
  if (rc != 0 || !started) {
    return @{@"valid": @NO, @"uncertain": @NO, @"bpm": @0, @"confidence": @0, @"beats": @[],
             @"method": @"spectral", @"downbeatIndex": @0, @"downbeatMargin": @0};
  }
  return ResultDict(tracker.finish(), @"spectral", 0, 0.f);
}

}  // namespace

@implementation RPBeatDetector

+ (NSDictionary<NSString *, id> *)detectBeatsInFileAtURL:(NSURL *)url
                                                 anchors:(NSArray<NSNumber *> *)anchors
                                             beatsPerBar:(NSInteger)beatsPerBar
                                                   error:(NSError **)error {
  AVAudioFile *file = [[AVAudioFile alloc] initForReading:url error:error];
  if (!file) return nil;
  const std::vector<double> anchorTimes = CleanTimes(anchors);

  @try {
    BOOL hardError = NO;
    NSDictionary *neural = DetectNeural(url, file, anchorTimes, beatsPerBar, &hardError, error);
    if (neural) return neural;
    if (hardError) return nil;
  } @catch (NSException *e) {
    NSLog(@"[RPBeatDetector] neural path exception: %@", e);
  }
  NSLog(@"[RPBeatDetector] falling back to the spectral tracker");
  return DetectSpectral(url, anchorTimes, error);
}

+ (NSDictionary<NSString *, id> *)downbeatPhaseForFileAtURL:(NSURL *)url
                                                      beats:(NSArray<NSNumber *> *)beats
                                                beatsPerBar:(NSInteger)beatsPerBar {
  Activation act;
  if (!LoadActivation(url, act)) return nil;
  std::vector<double> b;
  for (NSNumber *n in beats) b.push_back(n.doubleValue);
  float margin = 0.f;
  const int phase = repitch::BeatTracker::downbeatPhase(b, act.down.data(), act.down.size(), act.fps, (int)std::max<NSInteger>(beatsPerBar, 2), &margin);
  return @{@"downbeatIndex": @(phase), @"margin": @((double)margin)};
}

@end
