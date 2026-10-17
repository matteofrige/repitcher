import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as RepitchAudio from '../../../modules/repitch-audio';
import { s } from '../../i18n';
import { BeatDots } from '../../components/BeatDots';
import { BeatsPerBarPicker } from '../../components/BeatsPerBarPicker';
import { Button, Stepper } from '../../components/Controls';
import { Toggle } from '../../components/Toggle';
import { Paper } from '../../components/Paper';
import { Slider } from '../../components/Slider';
import { setTools, useTools } from '../../lib/library';
import { usePlayingTrackId } from '../../lib/player';
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
  const { bpm, beatsPerBar, volume, flash, follow } = useTools();
  const playingId = usePlayingTrackId();
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
            <BeatsPerBarPicker value={beatsPerBar} onChange={(n) => setMetronome({ beatsPerBar: n })} />
            <BeatDots count={beatsPerBar} active={activeBeat} />
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

          {RepitchAudio.beatFollowAvailable() ? (
            <View
              style={{
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: colors.rule,
                borderRadius: 12,
                padding: 16,
                gap: 8,
              }}>
              <T variant="headline">{s.metronome.followCardTitle}</T>
              <T variant="footnote">{s.metronome.followCardText}</T>
              {follow ? (
                <T variant="footnote" tone="tint">
                  {s.metronome.followCardOn}
                </T>
              ) : null}
              {playingId ? (
                <Button kind="secondary" label={s.metronome.followCardOpen} onPress={() => router.push('/player' as Href)} />
              ) : (
                <Button kind="secondary" label={s.metronome.followCardLibrary} onPress={() => router.navigate('/libreria' as Href)} />
              )}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Paper>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 28 },
  bpmRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', flexWrap: 'wrap', gap: 12 },
  flashRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  start: { minHeight: 56, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
