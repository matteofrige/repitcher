#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>

NS_ASSUME_NONNULL_BEGIN

/// In-process effect AUAudioUnit: real-time pitch shifting via Signalsmith Stretch.
/// Input and output frame counts are always equal (pure pitch shift, rate 1.0).
@interface RPPitchAudioUnit : AUAudioUnit

/// Transposition in semitones. Thread-safe; picked up by the render thread.
@property (nonatomic) float semitones;

/// Ask the render thread to flush the stretcher's internal state (call after a seek).
- (void)requestReset;

+ (AudioComponentDescription)componentDescription;

/// Registers the subclass in-process (idempotent).
+ (void)registerOnce;

@end

NS_ASSUME_NONNULL_END
