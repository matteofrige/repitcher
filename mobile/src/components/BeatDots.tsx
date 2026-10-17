import { StyleSheet, View } from 'react-native';

import { useColors } from '../theme';

/** One indicator per beat; the first (accent) is larger. The active one lights up in tint. */
export function BeatDots({ count, active, size }: { count: number; active: number; size?: 'regular' | 'small' }) {
  const colors = useColors();
  const small = size === 'small';
  const accent = small ? 20 : 28;
  const other = small ? 14 : 20;
  return (
    <View
      style={[styles.beats, small ? { gap: 10, minHeight: accent } : null]}
      accessible={false}
      importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, i) => {
        const d = i === 0 ? accent : other;
        const on = i === active;
        return (
          <View
            key={i}
            style={{
              width: d,
              height: d,
              borderRadius: d / 2,
              backgroundColor: on ? colors.tint : 'transparent',
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: on ? colors.tint : colors.ink,
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  beats: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 36 },
});
