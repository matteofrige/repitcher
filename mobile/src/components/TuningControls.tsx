import { Pressable, StyleSheet, Text, View } from 'react-native';

import { s } from '../i18n';
import {
  MAX_CENTS,
  MAX_REF_HZ,
  MAX_SEMITONES,
  MIN_REF_HZ,
  REF_PRESETS,
  REF_PRESET_LABELS,
  describeResult,
  signed,
  type Tuning,
} from '../lib/tuning';
import { useColors } from '../theme';
import { T, fonts, numerals } from '../theme/type';
import { Stepper, tick } from './Controls';
import { TuningStaff } from './TuningStaff';

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function BigValue({ text, unit, label }: { text: string; unit: string; label: string }) {
  const colors = useColors();
  return (
    <View accessible accessibilityLabel={label} style={{ alignItems: 'center', minWidth: 110 }}>
      <Text
        allowFontScaling
        maxFontSizeMultiplier={1.4}
        style={{ fontFamily: fonts.caslon, fontVariant: numerals, fontSize: 44, lineHeight: 52, color: colors.ink }}>
        {text}
      </Text>
      <T variant="footnote">{unit}</T>
    </View>
  );
}

/** Readout on the left, stepper on the right. */
function ValueRow({ value, children }: { value: React.ReactNode; children: React.ReactNode }) {
  return <View style={styles.valueRow}>{value}{children}</View>;
}

type RefProps = { value: number; onChange: (hz: number) => void };

/** ① The user's A: big value with − / + (1 Hz, hold to repeat) and a scrolling row of presets. */
export function RefPitchControl({ value, onChange }: RefProps) {
  const colors = useColors();
  const step = (d: number) => {
    const n = clamp(value + d, MIN_REF_HZ, MAX_REF_HZ);
    if (n !== value) onChange(n);
  };
  return (
    <View style={{ gap: 12 }}>
      <ValueRow value={<BigValue text={`${value}`} unit="Hz" label={s.tuning.refValueA11y(value)} />}>
        <Stepper
          holdable
          minusLabel={s.tuning.hzMinus}
          plusLabel={s.tuning.hzPlus}
          minusDisabled={value <= MIN_REF_HZ}
          plusDisabled={value >= MAX_REF_HZ}
          onMinus={() => step(-1)}
          onPlus={() => step(1)}
        />
      </ValueRow>
      {/* Wrapped, not scrolled: all presets (and the selected one) stay visible on every width. */}
      <View accessibilityRole="radiogroup" style={styles.chips}>
        {REF_PRESETS.map((hz) => {
          const selected = value === hz;
          const caption = REF_PRESET_LABELS[hz];
          const fg = selected ? colors.paper : colors.ink;
          return (
            <Pressable
              key={hz}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={s.tuning.refA11y(hz, caption)}
              onPress={() => {
                tick();
                onChange(hz);
              }}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? colors.tint : 'transparent',
                  borderColor: selected ? colors.tint : colors.rule,
                },
              ]}>
              <Text
                allowFontScaling
                maxFontSizeMultiplier={1.3}
                style={{ fontFamily: fonts.caslon, fontVariant: numerals, fontSize: 16, color: fg }}>
                {hz}
              </Text>
              {caption ? (
                <Text
                  allowFontScaling
                  maxFontSizeMultiplier={1.2}
                  style={{ fontFamily: fonts.caslon, fontSize: 11, color: selected ? colors.paper : colors.inkSecondary }}>
                  {caption}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

type TuneProps = {
  value: Tuning;
  onChange: (patch: Partial<Tuning>) => void;
};

/** ② Semitones: the staff (what the A becomes), its caption, readout and stepper. */
export function TranspositionControl({ value, onChange }: TuneProps) {
  const step = (d: number) => {
    const n = clamp(value.semitones + d, -MAX_SEMITONES, MAX_SEMITONES);
    if (n !== value.semitones) onChange({ semitones: n });
  };
  const spoken = s.tuning.spokenSemitones(value.semitones);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        <TuningStaff tuning={value} onChangeSemitones={(n) => onChange({ semitones: n })} />
        <T variant="callout" style={{ textAlign: 'center' }}>
          {describeResult(value)}
        </T>
      </View>
      <ValueRow value={<BigValue text={signed(value.semitones)} unit={s.tuning.unitSemitones} label={spoken} />}>
        <Stepper
          minusLabel={s.tuning.semitoneMinus}
          plusLabel={s.tuning.semitonePlus}
          minusDisabled={value.semitones <= -MAX_SEMITONES}
          plusDisabled={value.semitones >= MAX_SEMITONES}
          onMinus={() => step(-1)}
          onPlus={() => step(1)}
        />
      </ValueRow>
    </View>
  );
}

/** ③ Cents: readout and stepper (hold to repeat). */
export function FineTuneControl({ value, onChange }: TuneProps) {
  const step = (d: number) => {
    const n = clamp(value.cents + d, -MAX_CENTS, MAX_CENTS);
    if (n !== value.cents) onChange({ cents: n });
  };
  const spoken = s.tuning.spokenCents(value.cents);
  return (
    <ValueRow value={<BigValue text={signed(value.cents)} unit={s.tuning.unitCents} label={spoken} />}>
      <Stepper
        holdable
        minusLabel={s.tuning.centMinus}
        plusLabel={s.tuning.centPlus}
        minusDisabled={value.cents <= -MAX_CENTS}
        plusDisabled={value.cents >= MAX_CENTS}
        onMinus={() => step(-1)}
        onPlus={() => step(1)}
      />
    </ValueRow>
  );
}

const styles = StyleSheet.create({
  valueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', flexWrap: 'wrap', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 44,
    minWidth: 56,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
