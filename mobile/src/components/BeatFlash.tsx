import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';

import { useTools } from '../lib/library';
import { useMetronome } from '../lib/metronome';
import { useColors } from '../theme';

/** Whole-screen flash on each metronome beat (opt-in, meant to be seen from a music stand). */
export function BeatFlash() {
  const { flash } = useTools();
  const { flashTick, activeBeat } = useMetronome();
  const colors = useColors();
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!flash || flashTick === 0) return;
    const peak = activeBeat === 0 ? 0.85 : 0.5;
    // Reduce Motion: still flash (the user opted in), but no fade.
    opacity.set(
      reduced
        ? withSequence(withTiming(peak, { duration: 0 }), withDelay(120, withTiming(0, { duration: 0 })))
        : withSequence(withTiming(peak, { duration: 0 }), withDelay(60, withTiming(0, { duration: 140 }))),
    );
    // Only a new tick should retrigger the flash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashTick]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.tint }, style]} />;
}
