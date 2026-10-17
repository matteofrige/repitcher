#import "RPPitchAudioUnit.h"

#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <vector>

#include "signalsmith-stretch.h"

namespace {

constexpr UInt32 fourCC(char a, char b, char c, char d) {
  return (UInt32(a) << 24) | (UInt32(b) << 16) | (UInt32(c) << 8) | UInt32(d);
}

constexpr int kMaxChannels = 8;
constexpr AUAudioFrameCount kDefaultMaxFrames = 4096;

/// Everything the render thread touches. Allocated on the main thread
/// (allocateRenderResources), never on the render thread.
struct DSPState {
  signalsmith::stretch::SignalsmithStretch<float> stretch;
  std::atomic<float> semitones{0.0f};
  std::atomic<bool> resetRequested{false};
  float appliedSemitones = NAN;  // NAN forces the first setTransposeSemitones
  int channels = 0;
  AUAudioFrameCount maxFrames = 0;
  std::vector<float> inStorage;   // channels * maxFrames
  std::vector<float> outStorage;  // channels * maxFrames
  std::vector<uint8_t> ablStorage;  // AudioBufferList with `channels` buffers
  bool ready = false;
};

}  // namespace

@implementation RPPitchAudioUnit {
  std::unique_ptr<DSPState> _state;
  AUAudioUnitBus *_inputBus;
  AUAudioUnitBus *_outputBus;
  AUAudioUnitBusArray *_inputBusArray;
  AUAudioUnitBusArray *_outputBusArray;
}

+ (AudioComponentDescription)componentDescription {
  AudioComponentDescription desc = {};
  desc.componentType = kAudioUnitType_Effect;
  desc.componentSubType = fourCC('r', 'p', 'c', 'h');
  desc.componentManufacturer = fourCC('R', 'p', 't', 'c');
  desc.componentFlags = 0;
  desc.componentFlagsMask = 0;
  return desc;
}

+ (void)registerOnce {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    [AUAudioUnit registerSubclass:self
        asComponentDescription:[self componentDescription]
                          name:@"RePitch: Pitch Shifter"
                       version:1];
  });
}

- (instancetype)initWithComponentDescription:(AudioComponentDescription)componentDescription
                                     options:(AudioComponentInstantiationOptions)options
                                       error:(NSError **)outError {
  self = [super initWithComponentDescription:componentDescription options:options error:outError];
  if (!self) return nil;

  _state = std::make_unique<DSPState>();

  AVAudioFormat *format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:44100.0 channels:2];
  _inputBus = [[AUAudioUnitBus alloc] initWithFormat:format error:outError];
  if (!_inputBus) return nil;
  _outputBus = [[AUAudioUnitBus alloc] initWithFormat:format error:outError];
  if (!_outputBus) return nil;
  _inputBusArray = [[AUAudioUnitBusArray alloc] initWithAudioUnit:self
                                                          busType:AUAudioUnitBusTypeInput
                                                           busses:@[ _inputBus ]];
  _outputBusArray = [[AUAudioUnitBusArray alloc] initWithAudioUnit:self
                                                           busType:AUAudioUnitBusTypeOutput
                                                            busses:@[ _outputBus ]];
  self.maximumFramesToRender = kDefaultMaxFrames;
  return self;
}

- (AUAudioUnitBusArray *)inputBusses {
  return _inputBusArray;
}

- (AUAudioUnitBusArray *)outputBusses {
  return _outputBusArray;
}

#pragma mark - Parameters

- (float)semitones {
  return _state->semitones.load(std::memory_order_relaxed);
}

- (void)setSemitones:(float)semitones {
  _state->semitones.store(semitones, std::memory_order_relaxed);
}

- (void)requestReset {
  _state->resetRequested.store(true, std::memory_order_release);
}

#pragma mark - Render resources

- (BOOL)allocateRenderResourcesAndReturnError:(NSError **)outError {
  if (![super allocateRenderResourcesAndReturnError:outError]) return NO;

  AVAudioFormat *inFormat = _inputBus.format;
  AVAudioFormat *outFormat = _outputBus.format;
  const int channels = (int)outFormat.channelCount;
  if (inFormat.channelCount != outFormat.channelCount || channels < 1 || channels > kMaxChannels ||
      inFormat.sampleRate != outFormat.sampleRate) {
    if (outError) {
      *outError = [NSError errorWithDomain:NSOSStatusErrorDomain
                                      code:kAudioUnitErr_FormatNotSupported
                                  userInfo:nil];
    }
    [super deallocateRenderResources];
    return NO;
  }

  DSPState *s = _state.get();
  s->ready = false;
  s->channels = channels;
  s->maxFrames = self.maximumFramesToRender;
  s->stretch.presetDefault(channels, (float)outFormat.sampleRate);
  s->inStorage.assign((size_t)channels * s->maxFrames, 0.0f);
  s->outStorage.assign((size_t)channels * s->maxFrames, 0.0f);
  s->ablStorage.assign(offsetof(AudioBufferList, mBuffers) + sizeof(AudioBuffer) * (size_t)channels, 0);
  s->appliedSemitones = NAN;
  s->resetRequested.store(false, std::memory_order_relaxed);
  s->ready = true;
  return YES;
}

- (void)deallocateRenderResources {
  _state->ready = false;
  [super deallocateRenderResources];
}

#pragma mark - Render

- (AUInternalRenderBlock)internalRenderBlock {
  // Capture a raw pointer to the C++ state: no ObjC messaging, locks or allocations on the render thread.
  // The state lives as long as this AU, which outlives its render block.
  DSPState *s = _state.get();

  return ^AUAudioUnitStatus(AudioUnitRenderActionFlags *actionFlags,
                            const AudioTimeStamp *timestamp,
                            AUAudioFrameCount frameCount,
                            NSInteger outputBusNumber,
                            AudioBufferList *outputData,
                            const AURenderEvent *realtimeEventListHead,
                            AURenderPullInputBlock pullInputBlock) {
    if (!s->ready || frameCount > s->maxFrames) return kAudioUnitErr_TooManyFramesToProcess;
    if (!pullInputBlock) return kAudioUnitErr_NoConnection;

    const int channels = s->channels;

    // Pull input into our own buffers.
    AudioBufferList *inABL = reinterpret_cast<AudioBufferList *>(s->ablStorage.data());
    inABL->mNumberBuffers = (UInt32)channels;
    for (int c = 0; c < channels; c++) {
      inABL->mBuffers[c].mNumberChannels = 1;
      inABL->mBuffers[c].mDataByteSize = frameCount * sizeof(float);
      inABL->mBuffers[c].mData = s->inStorage.data() + (size_t)c * s->maxFrames;
    }
    AudioUnitRenderActionFlags pullFlags = 0;
    AUAudioUnitStatus status = pullInputBlock(&pullFlags, timestamp, frameCount, 0, inABL);
    if (status != noErr) return status;

    float *inPtrs[kMaxChannels];
    float *outPtrs[kMaxChannels];
    const UInt32 outBuffers = outputData->mNumberBuffers;
    for (int c = 0; c < channels; c++) {
      inPtrs[c] = static_cast<float *>(inABL->mBuffers[c].mData);
      if ((UInt32)c < outBuffers) {
        if (!outputData->mBuffers[c].mData) {
          outputData->mBuffers[c].mData = s->outStorage.data() + (size_t)c * s->maxFrames;
        }
        outputData->mBuffers[c].mDataByteSize = frameCount * sizeof(float);
        outPtrs[c] = static_cast<float *>(outputData->mBuffers[c].mData);
      } else {
        outPtrs[c] = s->outStorage.data() + (size_t)c * s->maxFrames;
      }
    }

    if (s->resetRequested.exchange(false, std::memory_order_acq_rel)) {
      s->stretch.reset();
    }
    const float semis = s->semitones.load(std::memory_order_relaxed);
    if (semis != s->appliedSemitones) {
      s->stretch.setTransposeSemitones(semis);
      s->appliedSemitones = semis;
    }

    s->stretch.process(inPtrs, (int)frameCount, outPtrs, (int)frameCount);
    return noErr;
  };
}

@end
