#import <AVFoundation/AVFoundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Feeds input-tap buffers into the C++ PitchDetector (MPM) and keeps the latest reading.
/// Plain ObjC interface (no C++). `processBuffer:` is called on the tap thread, `latestReading` on main:
/// access is serialised internally.
@interface RPPitchDetectorBridge : NSObject

/// Resets the history and sets the sampleRate of the input (window ~4096 samples @ 48 kHz).
- (void)prepareWithSampleRate:(double)sampleRate;

/// Appends channel 0 of the buffer; runs the detector every ~1024 new samples.
- (void)processBuffer:(AVAudioPCMBuffer *)buffer;

/// @{ @"seq": Int (changes at every new detection), @"frequency": Double (-1 = no signal),
///    @"clarity": Double 0..1, @"rms": Double, @"wave": NSArray<NSNumber *> (128 values, -1..1) }.
- (NSDictionary<NSString *, id> *)latestReading;

- (void)reset;

@end

NS_ASSUME_NONNULL_END
