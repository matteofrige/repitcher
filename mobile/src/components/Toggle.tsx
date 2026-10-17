import { Pressable, StyleSheet } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';

import { useColors } from '../theme';
import { tick } from './Controls';

const W = 52;
const H = 30;
const KNOB = 24;
const PAD = (H - KNOB) / 2;

/** Pill switch in the app's style (replaces the native Switch). */
export function Toggle({
  value,
  onValueChange,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  const progress = useDerivedValue(() => withTiming(value ? 1 : 0, { duration: 160 }), [value]);
  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [colors.rule, colors.tint]),
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * (W - KNOB - PAD * 2) }],
  }));
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 7, bottom: 7, left: 6, right: 6 }}
      onPress={() => {
        tick();
        onValueChange(!value);
      }}>
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.knob, { backgroundColor: colors.paper, shadowColor: colors.ink }, knobStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: W, height: H, borderRadius: H / 2, padding: PAD, justifyContent: 'center' },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    shadowOpacity: 0.3,
    shadowRadius: 1.5,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
