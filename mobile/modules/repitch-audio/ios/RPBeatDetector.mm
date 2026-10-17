#import "RPBeatDetector.h"

#import <AVFoundation/AVFoundation.h>
#include <algorithm>
#include <cmath>
#include <vector>

#include "beats/BeatTracker.hpp"

@implementation RPBeatDetector

+ (NSDictionary<NSString *, id> *)detectBeatsInFileAtURL:(NSURL *)url error:(NSError **)error {
  AVAudioFile *file = [[AVAudioFile alloc] initForReading:url error:error];
  if (!file) return nil;

  AVAudioFormat *format = file.processingFormat;
  const double sampleRate = format.sampleRate;
  const AVAudioFrameCount channels = format.channelCount;
  if (sampleRate <= 0 || file.length <= 0 || channels == 0) {
    return @{@"valid": @NO, @"bpm": @0, @"confidence": @0, @"beats": @[]};
  }

  const AVAudioFrameCount chunk = 32768;
  AVAudioPCMBuffer *buffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:chunk];
  if (!buffer) return nil;

  repitch::BeatTracker tracker;
  tracker.begin(sampleRate);
  std::vector<float> mono(chunk);

  AVAudioFramePosition remaining = file.length;
  BOOL failed = NO;
  while (remaining > 0) {
    @autoreleasepool {
      const AVAudioFrameCount want = (AVAudioFrameCount)std::min<AVAudioFramePosition>(remaining, chunk);
      NSError *readError = nil;
      if (![file readIntoBuffer:buffer frameCount:want error:&readError]) {
        if (error) *error = readError;
        failed = YES;
        break;
      }
      const AVAudioFrameCount got = buffer.frameLength;
      const float *const *data = buffer.floatChannelData;
      if (got == 0 || !data) break;
      for (AVAudioFrameCount i = 0; i < got; i++) {
        float sum = 0.f;
        for (AVAudioFrameCount ch = 0; ch < channels; ch++) sum += data[ch][i];
        mono[i] = sum / (float)channels;
      }
      tracker.push(mono.data(), got);
      remaining -= got;
    }
  }
  if (failed) return nil;

  const repitch::BeatTrackerResult res = tracker.finish();
  NSMutableArray<NSNumber *> *beats = [NSMutableArray arrayWithCapacity:res.beats.size()];
  for (double t : res.beats) [beats addObject:@(std::round(t * 10000.0) / 10000.0)];
  return @{
    @"valid": @(res.valid),
    @"bpm": @(res.medianBpm),
    @"confidence": @((double)res.confidence),
    @"beats": beats,
  };
}

@end
