#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Finds the beat positions of an audio file. Plain ObjC interface (no C++), so it can be part of
/// the Swift umbrella; the implementation lives in the .mm.
@interface RPBeatDetector : NSObject

/// Decodes the whole file in chunks (mono mix, never held in memory at once) and feeds the beat tracker.
/// `anchors`: times (seconds, in the file) the user tapped on the beat; the tracker is constrained to them.
/// Returns @{ @"valid": BOOL, @"uncertain": BOOL, @"bpm": Double, @"confidence": Double, @"beats": [Double] (seconds) },
/// or nil with `error` set if the file can't be read. Heavy: call from a background queue.
+ (nullable NSDictionary<NSString *, id> *)detectBeatsInFileAtURL:(NSURL *)url
                                                          anchors:(NSArray<NSNumber *> *)anchors
                                                            error:(NSError *_Nullable *_Nullable)error;

@end

NS_ASSUME_NONNULL_END
