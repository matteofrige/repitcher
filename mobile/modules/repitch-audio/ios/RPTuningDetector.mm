#import "RPTuningDetector.h"

#import <AVFoundation/AVFoundation.h>
#include <algorithm>
#include <vector>

#include "tuning/TuningEstimator.hpp"

static const double kWindowSeconds = 25.0;
static const double kCenters[] = {0.25, 0.50, 0.75};

@implementation RPTuningDetector

+ (NSDictionary<NSString *, id> *)detectInFileAtURL:(NSURL *)url error:(NSError **)error {
  AVAudioFile *file = [[AVAudioFile alloc] initForReading:url error:error];
  if (!file) return nil;

  AVAudioFormat *format = file.processingFormat;
  const double sampleRate = format.sampleRate;
  const AVAudioFramePosition total = file.length;
  const AVAudioFrameCount channels = format.channelCount;
  if (sampleRate <= 0 || total <= 0 || channels == 0) {
    return @{@"valid": @NO, @"refHz": @0, @"cents": @0, @"confidence": @0};
  }

  // (start, length) of each window in frames.
  struct Range { AVAudioFramePosition start; AVAudioFramePosition length; };
  std::vector<Range> ranges;
  const AVAudioFramePosition win = (AVAudioFramePosition)(kWindowSeconds * sampleRate);
  if (total <= 3 * win) {
    ranges.push_back({0, total});
  } else {
    for (double c : kCenters) {
      AVAudioFramePosition start = (AVAudioFramePosition)(c * (double)total) - win / 2;
      start = std::max<AVAudioFramePosition>(0, std::min(start, total - win));
      ranges.push_back({start, win});
    }
  }

  std::vector<float> mono;
  mono.reserve((size_t)std::min<AVAudioFramePosition>(total, 3 * win));

  const AVAudioFrameCount chunk = 32768;
  AVAudioPCMBuffer *buffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:chunk];
  if (!buffer) return nil;

  for (const Range &r : ranges) {
    file.framePosition = r.start;
    AVAudioFramePosition remaining = r.length;
    while (remaining > 0) {
      AVAudioFrameCount want = (AVAudioFrameCount)std::min<AVAudioFramePosition>(remaining, chunk);
      NSError *readError = nil;
      if (![file readIntoBuffer:buffer frameCount:want error:&readError]) {
        if (error) *error = readError;
        return nil;
      }
      const AVAudioFrameCount got = buffer.frameLength;
      if (got == 0) break;
      const float *const *data = buffer.floatChannelData;
      if (!data) break;
      for (AVAudioFrameCount i = 0; i < got; i++) {
        float sum = 0.f;
        for (AVAudioFrameCount ch = 0; ch < channels; ch++) sum += data[ch][i];
        mono.push_back(sum / (float)channels);
      }
      remaining -= got;
    }
  }

  if (mono.empty()) {
    return @{@"valid": @NO, @"refHz": @0, @"cents": @0, @"confidence": @0};
  }

  const repitch::TuningEstimate est = repitch::estimateTuning(mono.data(), mono.size(), (float)sampleRate);
  return @{
    @"valid": @(est.valid),
    @"refHz": @(est.refHz),
    @"cents": @(est.cents),
    @"confidence": @(est.confidence),
  };
}

@end
