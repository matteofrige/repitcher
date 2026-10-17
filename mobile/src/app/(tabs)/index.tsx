import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AboutButton } from '../../components/AboutButton';
import { BrandMark } from '../../components/BrandMark';
import { Paper } from '../../components/Paper';
import { FineTuneControl, RefPitchControl, TranspositionControl } from '../../components/TuningControls';
import { useGlobalTuning, useTrack } from '../../lib/library';
import { setCurrentOverride, setGlobal, usePlayingTrackId } from '../../lib/player';
import { NEUTRAL_TUNING, isNeutral } from '../../lib/tuning';
import { s } from '../../i18n';
import { column } from '../../theme/layout';
import { T, fonts } from '../../theme/type';

function Section({ n, title, text, children }: { n: number; title: string; text: string; children: ReactNode }) {
  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 2 }}>
        <T variant="headline" accessibilityRole="header">
          {`${n}. ${title}`}
        </T>
        <T variant="footnote">{text}</T>
      </View>
      {children}
    </View>
  );
}

/** Initial tab: the global tuning, in the order it makes sense — the instrument's A first. */
export default function TuningScreen() {
  const g = useGlobalTuning();
  const playing = useTrack(usePlayingTrackId());
  const hasOverride = !!playing?.override;

  return (
    <Paper>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={[styles.content, column()]}>
          <View style={{ gap: 12 }}>
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel="RePitch"
              style={styles.lockup}>
              <BrandMark size={44} />
              <T style={{ fontFamily: fonts.fell, fontSize: 28, lineHeight: 34, marginLeft: -2 }} importantForAccessibility="no">
                RePitch
              </T>
            </View>
            <View style={{ gap: 6 }}>
            <View style={styles.titleRow}>
              <T variant="largeTitle" accessibilityRole="header" style={{ flex: 1 }}>
                {s.tuning.title}
              </T>
              <AboutButton />
            </View>
            <T variant="footnote">{s.tuning.subtitle}</T>
            </View>
          </View>

          {hasOverride ? (
            <View style={styles.note}>
              <T variant="annotation">{s.tuning.playingHasOwn}</T>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.tuning.useGlobalA11y}
                onPress={() => setCurrentOverride(null)}
                style={({ pressed }) => [styles.noteBtn, { opacity: pressed ? 0.55 : 1 }]}>
                <T variant="callout" tone="tint">
                  {s.tuning.useGlobal}
                </T>
              </Pressable>
            </View>
          ) : null}

          <Section
            n={1}
            title={s.tuning.refTitle}
            text={s.tuning.refText}>
            <RefPitchControl value={g.refHz} onChange={(refHz) => setGlobal({ refHz })} />
          </Section>

          <Section
            n={2}
            title={s.tuning.transposeTitle}
            text={s.tuning.transposeText}>
            <TranspositionControl value={g} onChange={setGlobal} />
          </Section>

          <Section n={3} title={s.tuning.fineTitle} text={s.tuning.fineText}>
            <FineTuneControl value={g} onChange={setGlobal} />
          </Section>

          <View style={{ alignItems: 'center' }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.tuning.resetAllA11y}
              accessibilityState={{ disabled: isNeutral(g) }}
              disabled={isNeutral(g)}
              onPress={() => setGlobal(NEUTRAL_TUNING)}
              style={[styles.reset, { opacity: isNeutral(g) ? 0.35 : 1 }]}>
              <T variant="body" tone="tint">
                {s.tuning.resetAll}
              </T>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Paper>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 28 },
  lockup: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Stacked: the note can be long (and longer with Dynamic Type), the action sits under it.
  note: { gap: 2, alignItems: 'flex-start' },
  noteBtn: { minHeight: 44, justifyContent: 'center', paddingRight: 8 },
  reset: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
});
