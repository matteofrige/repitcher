#import <AVFoundation/AVFoundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Owns the C++ MetronomeCore and exposes it to Swift. Plain ObjC interface (no C++), so it can
/// be part of the Swift umbrella. All methods are called from the main thread; the audio thread
/// only touches the C++ core through the render block.
@interface RPMetronome : NSObject

/// Prepares the core for `sampleRate` and returns a mono Float32 source node at exactly that rate
/// (no sample-rate conversion in the click path). The previous node must be detached from the engine
/// before calling this (the core state is reset).
- (AVAudioSourceNode *)makeSourceNodeWithSampleRate:(double)sampleRate;

/// Atomics on the core: valid while running too (BPM changes never skip a beat).
- (void)configureWithBpm:(double)bpm beatsPerBar:(NSInteger)beatsPerBar volume:(double)volume;
- (void)start;
- (void)stop;

/// Beat follow: with `on` the internal generator is muted and only scheduled clicks play.
/// `clickAudible` NO keeps the beat events but makes the clicks silent (flash-only).
- (void)setFollow:(BOOL)on clickAudible:(BOOL)clickAudible;
/// Updates the bar length and volume used by the clicks (atomics, valid while running).
- (void)configureFollowWithBeatsPerBar:(NSInteger)beatsPerBar volume:(double)volume;
/// Schedules one click at `hostSeconds` (+[AVAudioTime secondsForHostTime:] domain, when the core renders it).
/// Returns NO when the core hasn't rendered a block yet (no host/frame mapping) or the queue is full.
- (BOOL)scheduleClickAtHostSeconds:(double)hostSeconds accent:(BOOL)accent beatIndex:(NSInteger)beatIndex;
/// Drops every click scheduled but not yet played (seek, pause, track change).
- (void)clearScheduled;

/// Pops the beats rendered since the last call. Each item:
/// @{ @"beat": Int (position in the bar), @"accent": Bool,
///    @"due": Double (seconds, host-clock domain of +[AVAudioTime secondsForHostTime:]) }.
/// `due` = render host time of the block + frame offset / sampleRate + `latency`
/// (the caller passes outputLatency + ioBufferDuration), i.e. when the click leaves the speaker.
- (NSArray<NSDictionary<NSString *, id> *> *)drainBeatsWithLatency:(NSTimeInterval)latency;

@end

NS_ASSUME_NONNULL_END
