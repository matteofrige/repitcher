import { Pressable, StyleSheet, Text, View } from 'react-native';

import { s } from '../i18n';
import { useColors } from '../theme';
import { fonts, numerals } from '../theme/type';

/** Chip row 1..6 to choose how many beats make a bar. */
export function BeatsPerBarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const colors = useColors();
  return (
    <View style={styles.chips} accessibilityRole="radiogroup">
      {[1, 2, 3, 4, 5, 6].map((n) => {
        const selected = n === value;
        return (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={s.metronome.beatsA11y(n)}
            onPress={() => onChange(n)}
            style={[
              styles.chip,
              { backgroundColor: selected ? colors.tint : 'transparent', borderColor: selected ? colors.tint : colors.rule },
            ]}>
            <Text
              allowFontScaling
              maxFontSizeMultiplier={1.4}
              style={{ fontFamily: fonts.caslon, fontVariant: numerals, fontSize: 17, color: selected ? colors.paper : colors.ink }}>
              {n}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    minWidth: 48,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
