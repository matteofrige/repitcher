import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { s } from '../../i18n';
import { Stepper } from '../../components/Controls';
import { Toggle } from '../../components/Toggle';
import { Paper } from '../../components/Paper';
import { Slider } from '../../components/Slider';
import { setTools, useTools } from '../../lib/library';
import { showAlert, showPrompt } from '../../lib/promptHost';
import { setMetronome, toggleMetronome, useMetronome } from '../../lib/metronome';
import { useColors } from '../../theme';
import { column } from '../../theme/layout';
import { T, fonts, numerals } from '../../theme/type';

const MIN_BPM = 40;
const MAX_BPM = 240;
const clampBpm = (n: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, n));

export default function MetronomeScreen() {
  const colors = useColors();
  const { bpm, beatsPerBar, volume, flash } = useTools();
  const { running, activeBeat } = useMetronome();

  const askBpm = async () => {
    const text = await showPrompt({
      title: s.metronome.askTitle,
      message: s.metronome.askBody(MIN_BPM, MAX_BPM),
      defaultValue: String(bpm),
      keyboardType: 'number-pad',
      confirmLabel: s.common.set,
    });
    if (text === null) return;
    const n = Math.round(parseFloat(text.replace(',', '.')));
    if (!Number.isFinite(n) || n < MIN_BPM || n > MAX_BPM) {
      void showAlert({ title: s.common.invalidValue, message: s.metronome.invalidBody(MIN_BPM, MAX_BPM) });
      return;
    }
    setMetronome({ bpm: n });
  };

  return (
    <Paper>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={[styles.content, column()]}>
          <T variant="largeTitle" accessibilityRole="header">
            {s.metronome.title}
          </T>

          <View style={{ gap: 4 }}>
            <View style={styles.bpmRow}>
              <View accessible accessibilityLabel={s.metronome.bpmA11y(bpm)} style={{ alignItems: 'center', minWidth: 110 }}>
                <Text
                  allowFontScaling
                  maxFontSizeMultiplier={1.4}
                  style={{ fontFamily: fonts.caslon, fontVariant: numerals, fontSize: 56, lineHeight: 64, color: colors.ink }}>
                  {bpm}
                </Text>
                <T variant="footnote">BPM</T>
              </View>
              <Stepper
                holdable
                minusLabel={s.metronome.bpmMinus}
                plusLabel={s.metronome.bpmPlus}
                minusDisabled={bpm <= MIN_BPM}
                plusDisabled={bpm >= MAX_BPM}
                onMinus={() => setMetronome({ bpm: clampBpm(bpm - 1) })}
                onPlus={() => setMetronome({ bpm: clampBpm(bpm + 1) })}
              />
            </View>
            <Slider
              label={s.metronome.tempo}
              valueText={`${bpm} BPM`}
              value={bpm}
              min={MIN_BPM}
              max={MAX_BPM}
              onChange={(v) => setMetronome({ bpm: v })}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.metronome.setValueA11y}
              onPress={() => void askBpm()}
              style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'center', paddingHorizontal: 12 }}>
              <T variant="callout" tone="tint">
                {s.metronome.setValueLink}
              </T>
            </Pressable>
          </View>

          <View style={{ gap: 10 }}>
            <T variant="headline">{s.metronome.beatsPerBar}</T>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {[1, 2, 3, 4, 5, 6].map((n) => {
                const selected = n === beatsPerBar;
                return (
                  <Pressable
                    key={n}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={s.metronome.beatsA11y(n)}
                    onPress={() => setMetronome({ beatsPerBar: n })}
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
            <Beats count={beatsPerBar} active={activeBeat} />
          </View>

          <View style={{ gap: 2 }}>
            <T variant="headline">{s.metronome.volume(volume)}</T>
            <Slider
              label={s.metronome.volumeLabel}
              valueText={s.metronome.volumeSpoken(volume)}
              value={volume}
              min={0}
              max={100}
              onChange={(v) => setMetronome({ volume: v })}
            />
          </View>

          <View style={styles.flashRow}>
            <T variant="body" style={{ flex: 1 }}>
              {s.metronome.flash}
            </T>
            <Toggle
              accessibilityLabel={s.metronome.flash}
              value={flash}
              onValueChange={(v) => setTools({ flash: v })}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={running ? s.metronome.stopA11y : s.metronome.startA11y}
            onPress={() => void toggleMetronome()}
            style={({ pressed }) => [
              styles.start,
              { backgroundColor: pressed ? colors.tintPressed : colors.tint },
            ]}>
            <T variant="headline" style={{ color: colors.paper, fontSize: 19 }}>
              {running ? s.common.stop : s.common.start}
            </T>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Paper>
  );
}

/** One indicator per beat; the first (accent) is larger. The active one lights up in tint. */
function Beats({ count, active }: { count: number; active: number }) {
  const colors = useColors();
  return (
    <View style={styles.beats} accessible={false} importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, i) => {
        const size = i === 0 ? 28 : 20;
        const on = i === active;
        return (
          <View
            key={i}
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
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
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 28 },
  bpmRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', flexWrap: 'wrap', gap: 12 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    minWidth: 48,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  beats: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 36 },
  flashRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  start: { minHeight: 56, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
