#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Estimates the tuning (reference A) of an audio file. Plain ObjC interface (no C++),
/// so it can be part of the Swift umbrella; the implementation lives in the .mm.
@interface RPTuningDetector : NSObject

/// Reads three windows of up to 25 s (centred at 25%, 50% and 75% of the file, or the whole
/// file when shorter than 75 s), mixes them to mono and estimates the tuning.
/// Returns @{ @"valid": BOOL, @"refHz": Double, @"cents": Double, @"confidence": Double },
/// or nil with `error` set if the file can't be read.
+ (nullable NSDictionary<NSString *, id> *)detectInFileAtURL:(NSURL *)url
                                                       error:(NSError *_Nullable *_Nullable)error;

@end

NS_ASSUME_NONNULL_END
