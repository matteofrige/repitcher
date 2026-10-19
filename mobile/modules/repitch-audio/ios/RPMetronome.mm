#import "RPMetronome.h"

#include <mach/mach_time.h>
#include <cmath>
#include <memory>
#include <string.h>

#include "metronome/MetronomeCore.hpp"

@implementation RPMetronome {
  std::unique_ptr<repitch::MetronomeCore> _core;
}

- (instancetype)init {
  if ((self = [super init])) {
    _core = std::make_unique<repitch::MetronomeCore>();
    _core->prepare(48000.0);
  }
  return self;
}

- (AVAudioSourceNode *)makeSourceNodeWithSampleRate:(double)sampleRate {
  _core->prepare(sampleRate);
  AVAudioFormat *format = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatFloat32
                                                           sampleRate:sampleRate
                                                             channels:1
                                                          interleaved:NO];
  // The block captures the raw core pointer only (no `self`, no ObjC messaging on the audio thread).
  // The core outlives every node: it lives as long as this RPMetronome, which owns the node's engine side.
  repitch::MetronomeCore *core = _core.get();
  return [[AVAudioSourceNode alloc]
      initWithFormat:format
         renderBlock:^OSStatus(BOOL *isSilence, const AudioTimeStamp *timestamp, AVAudioFrameCount frameCount,
                               AudioBufferList *outputData) {
           if (outputData->mNumberBuffers == 0) return noErr;
           float *out = (float *)outputData->mBuffers[0].mData;
           if (out == nullptr) return noErr;
           const uint64_t tag =
               (timestamp != nullptr && (timestamp->mFlags & kAudioTimeStampHostTimeValid)) ? timestamp->mHostTime : 0;
           const bool any = core->render(out, (int)frameCount, tag);
           for (UInt32 b = 1; b < outputData->mNumberBuffers; b++) {
             if (outputData->mBuffers[b].mData) memcpy(outputData->mBuffers[b].mData, out, frameCount * sizeof(float));
           }
           *isSilence = any ? NO : YES;
           return noErr;
         }];
}

- (void)configureWithBpm:(double)bpm beatsPerBar:(NSInteger)beatsPerBar volume:(double)volume {
  _core->setBpm(bpm);
  _core->setBeatsPerBar((int)beatsPerBar);
  _core->setVolume((float)volume);
}

- (void)start { _core->start(); }
- (void)stop { _core->stop(); }

- (void)setFollow:(BOOL)on clickAudible:(BOOL)clickAudible {
  _core->setFollowClickAudible(clickAudible);
  _core->setFollow(on);
}

- (void)configureFollowWithBeatsPerBar:(NSInteger)beatsPerBar volume:(double)volume {
  _core->setBeatsPerBar((int)beatsPerBar);
  _core->setVolume((float)volume);
}

- (BOOL)scheduleClickAtHostSeconds:(double)hostSeconds accent:(BOOL)accent beatIndex:(NSInteger)beatIndex {
  int64_t blockFrame = 0;
  uint64_t tag = 0;
  if (!_core->lastBlock(blockFrame, tag) || tag == 0) return NO;
  const double dt = hostSeconds - [AVAudioTime secondsForHostTime:tag];
  const int64_t frame = blockFrame + (int64_t)std::llround(dt * _core->sampleRate());
  return _core->scheduleClick(frame, accent, (int)beatIndex);
}

- (void)clearScheduled { _core->clearScheduled(); }

- (NSArray<NSDictionary<NSString *, id> *> *)drainBeatsWithLatency:(NSTimeInterval)latency {
  NSMutableArray *out = [NSMutableArray array];
  const double sr = _core->sampleRate();
  repitch::MetronomeEvent e;
  while (_core->popEvent(e)) {
    // Without a valid host time (tag 0) fall back to "now": the click was rendered a few ms ago at most.
    const double base = e.blockTag != 0 ? [AVAudioTime secondsForHostTime:e.blockTag] + (double)e.frameInBlock / sr
                                        : [AVAudioTime secondsForHostTime:mach_absolute_time()];
    [out addObject:@{
      @"beat": @(e.beatIndex),
      @"accent": @(e.accent),
      @"due": @(base + latency),
    }];
  }
  return out;
}

@end
