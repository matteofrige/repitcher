import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useIsFocused } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import * as RepitchAudio from '../../../modules/repitch-audio';
import { s } from '../../i18n';
import { Button, tick } from '../../components/Controls';
import { Paper } from '../../components/Paper';
import { sym } from '../../lib/icons';
import { setTools, useGlobalTuning, useTools } from '../../lib/library';
import { signed } from '../../lib/tuning';
import { hasTonic, isEqualTemperament, temperamentOffsets } from '../../lib/temperaments';
import { IN_TUNE_CENTS, NOTE_NAMES, createPitchTracker, readNote } from '../../lib/tuner';
import { useColors } from '../../theme';
import { CONTENT_MAX_WIDTH, column } from '../../theme/layout';
import { T, fonts, numerals } from '../../theme/type';

const RANGE = 50; // cents
const PAD = 16;
const GAUGE_H = 56;
const CHIP_GAP = 6;
const IN_TUNE_LEAVE_CENTS = 8;

/** Cents with one decimal, decimal comma and a real minus sign. */
const signedCents1 = (c: number) => (Math.abs(c) < 0.05 ? '0' : `${c > 0 ? '+' : '−'}${Math.abs(c).toFixed(1).replace('.', ',')}`);

type Status = 'starting' | 'running' | 'denied' | 'error';

export default function TunerScreen() {
  const colors = useColors();
  const reduced = useReducedMotion();
  const refHz = useGlobalTuning().refHz;
  const tools = useTools();
  const { tunerTarget } = tools;
  const offsets = useMemo(
    () => temperamentOffsets(tools),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tools.temperament, tools.temperamentTonic, tools.customCents],
  );
  const [status, setStatus] = useState<Status>('starting');
  const [frequency, setFrequency] = useState(-1);
  const [wave, setWave] = useState<number[]>([]);
  const [width, setWidth] = useState(0);
  // Bumped to start the microphone again (Retry button, or coming back from Settings after granting).
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setStatus('starting');
    setAttempt((a) => a + 1);
  };

  // Pitch tracker (hysteresis, snap on note change), UI throttled to ~12/s.
  const tracker = useRef(createPitchTracker());
  const lastEmit = useRef(0);
  // Note held by the Auto-mode hysteresis, and the "in tune" state (enter at 5 cents, leave past 8).
  const [held, setHeld] = useState<{ midi: number | null; inTune: boolean }>({ midi: null, inTune: false });

  // The screen stays focused while the user visits Settings: on return, try again by ourselves
  // instead of leaving the "denied" message up with the permission now granted.
  useEffect(() => {
    if (status !== 'denied' && status !== 'error') return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      setStatus('starting');
      setAttempt((a) => a + 1);
    });
    return () => sub.remove();
  }, [status]);

  // Microphone session: alive while the tab is focused; restarted on every `attempt`.
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    let cancelled = false;
    tracker.current.reset();
    lastEmit.current = 0;
    void activateKeepAwakeAsync('repitch-tuner').catch(() => {});
    // ('starting' and 'running' render the same; the handlers that bump `attempt` reset the status.)
    const sub = RepitchAudio.addTunerReadingListener((e) => {
      const now = Date.now();
      const shown = tracker.current.push(e.frequency, e.clarity, now);
      if (now - lastEmit.current >= 80) {
        lastEmit.current = now;
        setFrequency(shown);
        setWave(e.wave);
      }
    });
    RepitchAudio.tunerStart()
      .then(() => !cancelled && setStatus('running'))
      .catch((err: unknown) => {
        if (cancelled) return;
        const code = (err as { code?: string })?.code ?? '';
        const msg = err instanceof Error ? err.message : '';
        setStatus(code === 'E_MIC_DENIED' || msg.includes('E_MIC_DENIED') ? 'denied' : 'error');
      });
    return () => {
      cancelled = true;
      void deactivateKeepAwake('repitch-tuner').catch(() => {});
      sub.remove();
      void RepitchAudio.tunerStop().catch(() => {});
      setFrequency(-1);
      setWave([]);
    };
  }, [focused, attempt]);

  // Reference tone: octave 4 of the target note (Auto plays A), relative to the user's A.
  const [toneOn, setToneOn] = useState(false);
  const tonePc = tunerTarget === 'auto' ? 9 : tunerTarget;
  const toneHz = refHz * Math.pow(2, (tonePc - 9) / 12) * Math.pow(2, offsets[tonePc] / 1200);
  useEffect(() => {
    if (!toneOn || !focused) return;
    // Re-runs on target / refHz changes: the engine glides to the new pitch.
    void RepitchAudio.toneStart(toneHz).catch(() => setToneOn(false));
  }, [toneOn, toneHz, focused]);
  // Leaving the tab switches the tone off.
  useEffect(() => {
    if (!focused) return;
    return () => setToneOn(false);
  }, [focused]);
  useEffect(() => {
    if (toneOn && focused) return;
    void RepitchAudio.toneStop().catch(() => {});
  }, [toneOn, focused]);
  useEffect(() => {
    if (!toneOn) return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') setToneOn(false);
    });
    return () => sub.remove();
  }, [toneOn]);
  useEffect(() => () => void RepitchAudio.toneStop().catch(() => {}), []);

  const equalTemp = isEqualTemperament(tools);
  const temperamentLabel =
    s.temperament.names[tools.temperament] + (hasTonic(tools.temperament) ? ` · ${NOTE_NAMES[tools.temperamentTonic]}` : '');
  const hasSignal = frequency > 0;
  const note = hasSignal ? readNote(frequency, refHz, tunerTarget, held.midi, offsets) : null;
  const cents = note?.cents ?? 0;
  const inTune = !!note && Math.abs(cents) <= (held.inTune ? IN_TUNE_LEAVE_CENTS : IN_TUNE_CENTS);
  const nextMidi = note && tunerTarget === 'auto' ? note.midi : null;
  if (nextMidi !== held.midi || inTune !== held.inTune) setHeld({ midi: nextMidi, inTune });

  const usable = Math.max(1, width - 2 * PAD);
  const xFor = (c: number) => PAD + ((Math.max(-RANGE, Math.min(RANGE, c)) + RANGE) / (2 * RANGE)) * usable;
  // The needle rests at 0 through plain layout (`left`); the shared value only animates the offset from it,
  // so a stale animation can never leave the needle off-centre (seen on a tablet after rotations).
  const needleOffset = useSharedValue(0);
  useEffect(() => {
    const target = hasSignal ? xFor(cents) - xFor(0) : 0;
    needleOffset.set(reduced ? target : withTiming(target, { duration: 80 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents, hasSignal, width, reduced]);
  const needleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: needleOffset.get() }] }));

  const chooseTarget = (target: number | 'auto') => {
    if (target === tunerTarget) return;
    tick();
    setTools({ tunerTarget: target });
  };
  // Six notes per row: two even rows, so every pitch class is one tap away.
  const noteW = Math.max(44, (width - 5 * CHIP_GAP) / 6 - 0.5);
  const targetChip = (target: number | 'auto', label: string, w?: number) => {
    const selected = tunerTarget === target;
    return (
      <Pressable
        key={String(target)}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={label}
        onPress={() => chooseTarget(target)}
        style={[
          styles.chip,
          w ? { width: w } : { paddingHorizontal: 16 },
          { backgroundColor: selected ? colors.tint : 'transparent', borderColor: selected ? colors.tint : colors.rule },
        ]}>
        <Text
          allowFontScaling
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ fontFamily: fonts.caslon, fontSize: 16, color: selected ? colors.paper : colors.ink }}>
          {label}
        </Text>
      </Pressable>
    );
  };

  const waveW = Math.max(1, width);
  const wavePoints = wave
    .map((v, i) => `${((i / Math.max(1, wave.length - 1)) * waveW).toFixed(1)},${(22 - Math.max(-1, Math.min(1, v)) * 20).toFixed(1)}`)
    .join(' ');

  const verdict = !note
    ? s.tuner.playNote
    : inTune
      ? s.tuner.inTune
      : cents > 0
        ? s.tuner.sharp(signed(cents))
        : s.tuner.flat(signed(cents));

  return (
    <Paper>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={[styles.content, column()]}
          onLayout={(e) => setWidth(Math.min(e.nativeEvent.layout.width, CONTENT_MAX_WIDTH) - 40)}>
          <T variant="largeTitle" accessibilityRole="header">
            {s.tuner.title}
          </T>

          {status === 'denied' ? (
            <View style={{ gap: 16, paddingTop: 16 }}>
              <T variant="body">
                {s.tuner.deniedBody}
              </T>
              <Button label={s.tuner.openSettings} onPress={() => void Linking.openSettings()} />
            </View>
          ) : status === 'error' ? (
            <View style={{ gap: 16, paddingTop: 16 }}>
              <T variant="body">{s.tuner.micError}</T>
              <Button label={s.common.retry} kind="secondary" onPress={retry} />
            </View>
          ) : (
            <>
              <View
                accessible
                accessibilityLabel={note ? s.tuner.readingA11y(note.name, note.octave, verdict, s.tuner.frequencySpoken(frequency)) : s.tuner.noSignalA11y}
                accessibilityLiveRegion="polite"
                style={{ alignItems: 'center', gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', minHeight: 100 }}>
                  <Text
                    allowFontScaling
                    maxFontSizeMultiplier={1.3}
                    style={{
                      fontFamily: fonts.fell,
                      fontSize: 88,
                      lineHeight: 100,
                      // Placeholder dash in pencil, so the smear of an 88 pt em dash reads as "nothing yet".
                      color: note ? (inTune ? colors.success : colors.ink) : colors.pencil,
                      opacity: note ? 1 : 0.5,
                    }}>
                    {note ? note.name : '—'}
                  </Text>
                  {note ? (
                    <Text
                      allowFontScaling
                      maxFontSizeMultiplier={1.3}
                      style={{ fontFamily: fonts.caslon, fontVariant: numerals, fontSize: 22, lineHeight: 26, marginTop: 12, color: colors.inkSecondary }}>
                      {note.octave}
                    </Text>
                  ) : null}
                </View>
                <Text
                  allowFontScaling
                  maxFontSizeMultiplier={1.4}
                  style={{ fontFamily: fonts.caslon, fontVariant: numerals, fontSize: 20, color: colors.inkSecondary }}>
                  {hasSignal ? s.tuner.frequency(frequency) : ' '}
                </Text>
                {note && !equalTemp ? (
                  <T variant="footnote" style={{ textAlign: 'center' }}>
                    {s.temperament.note(temperamentLabel, signedCents1(offsets[NOTE_NAMES.indexOf(note.name)]))}
                  </T>
                ) : null}
              </View>

              <View accessible={false} importantForAccessibility="no-hide-descendants">
                <View style={{ height: GAUGE_H }}>
                  <Svg width={width} height={GAUGE_H}>
                    <Rect
                      x={xFor(-IN_TUNE_CENTS)}
                      y={4}
                      width={xFor(IN_TUNE_CENTS) - xFor(-IN_TUNE_CENTS)}
                      height={GAUGE_H - 22}
                      fill={inTune ? colors.success : colors.tint}
                      opacity={inTune ? 0.4 : 0.22}
                    />
                    {Array.from({ length: 11 }, (_, i) => (i - 5) * 10).map((c) => (
                      <Line
                        key={c}
                        x1={xFor(c)}
                        x2={xFor(c)}
                        y1={GAUGE_H - 22}
                        y2={GAUGE_H - 22 + (c === 0 || Math.abs(c) === RANGE ? 14 : 8)}
                        stroke={colors.ink}
                        strokeWidth={c === 0 ? 1.5 : 1}
                      />
                    ))}
                    <Line x1={PAD} x2={width - PAD} y1={GAUGE_H - 22} y2={GAUGE_H - 22} stroke={colors.ink} strokeWidth={1} />
                    {[-50, 0, 50].map((c) => (
                      <SvgText key={c} x={xFor(c)} y={GAUGE_H - 1} fontFamily={fonts.caslon} fontSize={11} fill={colors.inkSecondary} textAnchor="middle">
                        {signed(c)}
                      </SvgText>
                    ))}
                  </Svg>
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      { position: 'absolute', left: xFor(0) - 1, top: 0, width: 2, height: GAUGE_H - 20, backgroundColor: inTune ? colors.success : colors.ink, opacity: hasSignal ? 1 : 0.3 },
                      needleStyle,
                    ]}
                  />
                </View>
                <T variant="headline" style={{ textAlign: 'center', color: inTune ? colors.success : colors.ink }}>
                  {verdict}
                </T>
              </View>

              <View accessible={false} importantForAccessibility="no-hide-descendants">
                <Svg width={width} height={44}>
                  <Line x1={0} x2={width} y1={22} y2={22} stroke={colors.rule} strokeWidth={StyleSheet.hairlineWidth} />
                  {wave.length > 1 ? <Polyline points={wavePoints} fill="none" stroke={colors.pencil} strokeWidth={1} /> : null}
                </Svg>
              </View>

              <View style={{ gap: 8 }}>
                <View style={styles.targetHeader}>
                  <T variant="callout" accessibilityRole="header">
                    {s.tuner.targetTitle}
                  </T>
                  <View accessibilityRole="radiogroup">{targetChip('auto', s.tuner.auto)}</View>
                </View>
                <View accessibilityRole="radiogroup" accessibilityLabel={s.tuner.targetTitle} style={styles.notes}>
                  {NOTE_NAMES.map((name, i) => targetChip(i, name, noteW))}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${s.temperament.rowLabel}: ${temperamentLabel}`}
                  onPress={() => router.push('/temperamento' as never)}
                  style={({ pressed }) => [styles.tempRow, { borderColor: colors.rule, opacity: pressed ? 0.55 : 1 }]}>
                  <T variant="body" style={{ flex: 1 }}>
                    {s.temperament.rowLabel}
                  </T>
                  <T variant="body" tone="tint" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {temperamentLabel}
                  </T>
                  <SymbolView name={sym('chevron.right')} size={13} tintColor={colors.pencil} resizeMode="scaleAspectFit" style={{ width: 16, height: 16 }} />
                </Pressable>
                {RepitchAudio.hasTone() ? (
                  <>
                    <Button
                      kind={toneOn ? 'primary' : 'secondary'}
                      symbol={sym(toneOn ? 'stop.fill' : 'speaker.wave.2.fill')}
                      label={toneOn ? s.tuner.toneStop : s.tuner.tonePlay(NOTE_NAMES[tonePc], s.tuner.frequency(toneHz))}
                      onPress={() => {
                        tick();
                        setToneOn((v) => !v);
                      }}
                      style={{ marginTop: 8 }}
                    />
                  </>
                ) : null}
                <T variant="footnote">{RepitchAudio.hasTone() ? s.tuner.referenceNote(refHz) : s.tuner.referenceOnly(refHz)}</T>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Paper>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 16 },
  targetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tempRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  notes: { flexDirection: 'row', flexWrap: 'wrap', gap: CHIP_GAP },
  chip: {
    minHeight: 44,
    paddingHorizontal: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
