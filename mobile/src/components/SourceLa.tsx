import { Pressable, StyleSheet, View } from 'react-native';

import { s } from '../i18n';
import { DETECTION_MIN_CONFIDENCE, setTrackSourceHz, sourceHzOf, type Track } from '../lib/library';
import { showActionSheet, showAlert, showPrompt } from '../lib/promptHost';
import { MAX_REF_HZ, MIN_REF_HZ, REF_PRESETS, correctionCents, formatHz, signed } from '../lib/tuning';
import { useColors } from '../theme';
import { T, numerals } from '../theme/type';

function chipText(track: Track): string {
  if (track.sourceHz != null) return s.sourceLa.manual(formatHz(track.sourceHz));
  if (track.detection === 'pending') return s.sourceLa.detecting;
  if (track.detection === 'done' && track.detectedHz != null) {
    const hz = formatHz(track.detectedHz);
    return (track.detectedConfidence ?? 0) < DETECTION_MIN_CONFIDENCE ? s.sourceLa.uncertain(hz) : s.sourceLa.detected(hz);
  }
  return s.sourceLa.notDetected;
}

/** "La del brano": detected or manual source A, and the correction towards the user's A. */
export function SourceLa({ track, myLa }: { track: Track; myLa: number }) {
  const colors = useColors();
  const source = sourceHzOf(track);
  const cents = Math.round(correctionCents(myLa, source));

  const askValue = async () => {
    const text = await showPrompt({
      title: s.sourceLa.askTitle,
      message: s.sourceLa.askBody(MIN_REF_HZ, MAX_REF_HZ),
      defaultValue: String(Math.round(source)),
      keyboardType: 'number-pad',
      confirmLabel: s.common.set,
    });
    if (text === null) return;
    const hz = Math.round(parseFloat(text.replace(',', '.')));
    if (!Number.isFinite(hz) || hz < MIN_REF_HZ || hz > MAX_REF_HZ) {
      void showAlert({ title: s.common.invalidValue, message: s.sourceLa.invalidBody(MIN_REF_HZ, MAX_REF_HZ) });
      return;
    }
    setTrackSourceHz(track.id, hz);
  };

  const pick = async () => {
    const hasDetected = track.detection === 'done' && track.detectedHz !== null;
    const labels: string[] = [];
    const values: (number | null)[] = [];
    if (hasDetected) {
      const hz = track.detectedHz as number;
      const confident = (track.detectedConfidence ?? 0) >= DETECTION_MIN_CONFIDENCE;
      // Confident: back to automatic (null). Uncertain: the user explicitly accepts it, so pin it.
      labels.push(confident ? s.sourceLa.pickDetected(formatHz(hz)) : s.sourceLa.pickDetectedUncertain(formatHz(hz)));
      values.push(confident ? null : Math.round(hz));
    }
    for (const hz of REF_PRESETS) {
      labels.push(`${hz} Hz`);
      values.push(hz);
    }
    labels.push(s.sourceLa.other);
    const i = await showActionSheet({
      title: s.sourceLa.sheetTitle,
      options: labels.map((label) => ({ label })),
    });
    if (i === null) return;
    if (i < values.length) setTrackSourceHz(track.id, values[i]);
    else void askValue();
  };

  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.sourceLa.chipA11y(chipText(track))}
          onPress={() => void pick()}
          style={{
            minHeight: 44,
            paddingHorizontal: 12,
            justifyContent: 'center',
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.tint,
            borderRadius: 8,
          }}>
          <T variant="footnote" maxScale={1.3} style={{ color: colors.tint, fontVariant: numerals }}>
            {chipText(track)}
          </T>
        </Pressable>
      </View>
      {cents !== 0 ? (
        <T variant="annotation">
          {s.sourceLa.corrected(Number(formatHz(myLa)), signed(cents))}
        </T>
      ) : null}
    </View>
  );
}
