#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Finds the beat positions of an audio file. Plain ObjC interface (no C++), so it can be part of
/// the Swift umbrella; the implementation lives in the .mm.
///
/// Primary path: the Beat This! network (Core ML) + our HMM decoder (BeatTracker::analyzeActivation).
/// The activations are cached on disk, so re-analysis with anchors / another meter does not rerun the net.
/// If the model can't run, falls back to the spectral-flux tracker.
@interface RPBeatDetector : NSObject

/// Decodes the whole file in chunks (mono mix, never held in memory at once).
/// `anchors`: times (seconds, in the file) the user tapped on the beat; the tracker is constrained to them.
/// Returns @{ @"valid": BOOL, @"uncertain": BOOL, @"bpm": Double, @"confidence": Double, @"beats": [Double] (seconds),
///            @"method": @"neural" | @"spectral", @"downbeatIndex": Int, @"downbeatMargin": Double },
/// or nil with `error` set if the file can't be read. Heavy: call from a background queue.
+ (nullable NSDictionary<NSString *, id> *)detectBeatsInFileAtURL:(NSURL *)url
                                                          anchors:(NSArray<NSNumber *> *)anchors
                                                      beatsPerBar:(NSInteger)beatsPerBar
                                                            error:(NSError *_Nullable *_Nullable)error;

/// Downbeat phase for given beats from the cached neural activation. Nil if there is no cache for this file.
/// Returns @{ @"downbeatIndex": Int, @"margin": Double }.
+ (nullable NSDictionary<NSString *, id> *)downbeatPhaseForFileAtURL:(NSURL *)url
                                                               beats:(NSArray<NSNumber *> *)beats
                                                         beatsPerBar:(NSInteger)beatsPerBar;

@end

NS_ASSUME_NONNULL_END
