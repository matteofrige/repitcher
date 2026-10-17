import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as RepitchAudio from '../../modules/repitch-audio';
import { Button, tick } from '../components/Controls';
import { Paper } from '../components/Paper';
import { PromptHost } from '../components/PromptHost';
import { HeaderTextButton, ScreenHeader } from '../components/ScreenHeader';
import { s } from '../i18n';
import { sym } from '../lib/icons';
import {
  doubleBeats,
  getTrack,
  halveBeats,
  nearestBeatIndex,
  reanalyseBeats,
  resetBeats,
  setBeatAnchors,
  setDownbeatAt,
  useTools,
  useTrack,
} from '../lib/library';
import { toggle, usePlayer, usePlayerProgress } from '../lib/player';
import { showActionSheet, showAlert } from '../lib/promptHost';
import { formatDuration } from '../lib/tuning';
import { useColors } from '../theme';
import { column } from '../theme/layout';
import { numerals, T } from '../theme/type';

/** Taps sorted ascending (the native calls can come back out of order). */
function insertSorted(list: number[], t: number): number[] {
  const out = list.concat(t);
  out.sort((a, b) => a - b);
  return out;
}

/** Keeps the anchors outside the tapped span and replaces those inside it with the new taps. */
function mergeAnchors(anchors: number[], taps: number[]): number[] {
  if (taps.length === 0) return anchors;
  const lo = Math.min(...taps);
  const hi = Math.max(...taps);
  return anchors
    .filter((a) => a < lo || a > hi)
    .concat(taps)
    .sort((a, b) => a - b);
}

export default function BeatEditScreen() {
  const colors = useColors();
  const { queue, index, isPlaying, loading } = usePlayer();
  const { position, duration } = usePlayerProgress();
  const track = useTrack(queue[index]);
  const { follow, beatsPerBar } = useTools();

  const [taps, setTaps] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind: 'ok' | 'error' | 'info' } | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);

  useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
    },
    [],
  );

  if (!track) return <Paper />;
  const id = track.id;

  const notify = (text: string | null, kind: 'ok' | 'error' | 'info' = 'info') => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = null;
    setStatus(text ? { text, kind } : null);
    if (!text) return;
    if (kind === 'ok') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      statusTimer.current = setTimeout(() => setStatus(null), 4000);
    } else if (kind === 'error') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  };

  const setArm = (v: boolean) => {
    armedRef.current = v;
    setArmed(v);
  };

  const onTapIn = (e: GestureResponderEvent) => {
    tick();
    const ts = e.nativeEvent.timestamp;
    void RepitchAudio.beatTapPosition(ts)
      .then((pos) => {
        if (pos === null || !Number.isFinite(pos) || pos < 0) return;
        if (armedRef.current) {
          const beats = getTrack(id)?.beats;
          if (beats && beats.times.length > 0) {
            setDownbeatAt(id, nearestBeatIndex(beats.times, pos));
            notify(s.beatEdit.setDownbeatDone, 'ok');
          }
          setArm(false);
          return;
        }
        setTaps((cur) => insertSorted(cur, pos));
        notify(null);
      })
      .catch(() => {});
  };

  const apply = async () => {
    if (busy) return;
    if (taps.length === 0) {
      notify(s.beatEdit.noTaps, 'error');
      return;
    }
    setBusy(true);
    notify(null);
    try {
      setBeatAnchors(id, mergeAnchors(track.beats?.anchors ?? [], taps));
      const r = await reanalyseBeats(id);
      if (!r) {
        notify(s.beatEdit.applyFailed, 'error');
      } else {
        setTaps([]);
        notify(r.bpm > 0 ? s.beatEdit.applied(Math.round(r.bpm)) : s.beatEdit.appliedNoBpm, 'ok');
      }
    } catch (e) {
      console.warn('RePitch: beat re-analysis failed', e);
      notify(s.beatEdit.applyFailed, 'error');
    } finally {
      setBusy(false);
    }
  };

  const halve = async () => {
    const i = await showActionSheet({
      title: s.beatEdit.halfTitle,
      options: [{ label: s.beatEdit.halfFromFirst }, { label: s.beatEdit.halfFromSecond }],
      cancelLabel: s.beatEdit.cancel,
    });
    if (i === 0 || i === 1) {
      halveBeats(id, i);
      notify(s.beatEdit.halfDone, 'ok');
    }
  };

  const reset = async () => {
    const i = await showAlert({
      title: s.beatEdit.resetTitle,
      message: s.beatEdit.resetMessage,
      buttons: [{ label: s.beatEdit.cancel, style: 'cancel' }, { label: s.beatEdit.resetConfirm, style: 'destructive' }],
    });
    if (i !== 1) return;
    setBusy(true);
    setTaps([]);
    setArm(false);
    notify(null);
    try {
      const r = await resetBeats(id);
      if (r) notify(r.bpm > 0 ? s.beatEdit.applied(Math.round(r.bpm)) : s.beatEdit.appliedNoBpm, 'ok');
      else notify(s.beatEdit.applyFailed, 'error');
    } finally {
      setBusy(false);
    }
  };

  const hasBeats = !!track.beats && track.beats.times.length > 0;
  const valid = !!track.beats?.valid && track.beats.bpm > 0;

  return (
    <Paper>
      <SafeAreaView style={{ flex: 1 }} edges={Platform.OS === 'android' ? ['top', 'bottom'] : ['bottom']}>
        <ScreenHeader
          inModal
          title={s.beatEdit.title}
          right={<HeaderTextButton label={s.beatEdit.done} bold onPress={() => router.back()} />}
        />
        <View
          accessibilityLiveRegion="polite"
          style={{
            backgroundColor: colors.plate,
            paddingVertical: 12,
            paddingHorizontal: 20,
            gap: 4,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.rule,
          }}>
          {busy ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={colors.inkSecondary} />
                <T variant="callout" style={{ fontWeight: '700', flex: 1 }}>
                  {s.beatEdit.applying}
                </T>
              </View>
              <T variant="footnote">{s.beatEdit.busyNote}</T>
            </>
          ) : status ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <SymbolView
                name={
                  status.kind === 'ok'
                    ? sym('checkmark.circle.fill')
                    : status.kind === 'error'
                      ? sym('exclamationmark.triangle.fill')
                      : sym('info.circle')
                }
                size={18}
                tintColor={status.kind === 'error' ? colors.danger : colors.tint}
                resizeMode="scaleAspectFit"
              />
              <T variant="callout" tone={status.kind === 'error' ? 'danger' : undefined} style={{ flex: 1 }}>
                {status.text}
              </T>
            </View>
          ) : (
            <T variant="callout">
              {valid && track.beats ? s.beatEdit.now(Math.round(track.beats.bpm), beatsPerBar) : s.beatEdit.nowNone}
            </T>
          )}
          {!follow ? <T variant="footnote">{s.beatEdit.followOff}</T> : null}
        </View>
        <ScrollView contentContainerStyle={[{ padding: 20, paddingBottom: 48, gap: 28 }, column(560)]}>
          <Section n={1} title={s.beatEdit.s1Title} text={s.beatEdit.s1Text}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isPlaying ? s.beatEdit.pauseA11y : s.beatEdit.playA11y}
                onPress={() => void toggle()}
                style={({ pressed }) => ({
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? colors.tintPressed : colors.tint,
                })}>
                {loading ? (
                  <ActivityIndicator color={colors.paper} />
                ) : (
                  <SymbolView
                    name={isPlaying ? sym('pause.fill') : sym('play.fill')}
                    size={24}
                    tintColor={colors.paper}
                    resizeMode="scaleAspectFit"
                  />
                )}
              </Pressable>
              <T variant="callout" style={[{ flex: 1 }, { fontVariant: numerals }]}>
                {s.beatEdit.position(formatDuration(position), formatDuration(duration))}
              </T>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.beatEdit.tapA11y}
              accessibilityHint={isPlaying ? undefined : s.beatEdit.tapHintNotPlaying}
              onPressIn={onTapIn}
              style={({ pressed }) => ({
                minHeight: 160,
                borderRadius: 16,
                borderWidth: 2,
                borderColor: armed ? colors.danger : colors.tint,
                backgroundColor: pressed ? colors.rule : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: 16,
              })}>
              <T variant="title" tone={armed ? 'danger' : 'tint'}>
                {s.beatEdit.tap}
              </T>
              {taps.length > 0 ? (
                <T variant="title" style={{ fontVariant: numerals }} accessibilityElementsHidden importantForAccessibility="no">
                  {taps.length}
                </T>
              ) : null}
              {armed ? (
                <T variant="footnote" style={{ textAlign: 'center' }}>
                  {s.beatEdit.setDownbeatArmed}
                </T>
              ) : !isPlaying ? (
                <T variant="footnote" style={{ textAlign: 'center' }}>
                  {s.beatEdit.tapHintNotPlaying}
                </T>
              ) : null}
            </Pressable>

            <View style={{ gap: 8 }} accessibilityLiveRegion="polite">
              <T variant="callout">{s.beatEdit.tapsCount(taps.length)}</T>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button
                  kind="secondary"
                  label={s.beatEdit.undo}
                  disabled={taps.length === 0 || busy}
                  onPress={() => setTaps((c) => c.slice(0, -1))}
                  style={{ flex: 1 }}
                />
                <Button
                  kind="secondary"
                  label={s.beatEdit.clear}
                  disabled={taps.length === 0 || busy}
                  onPress={() => setTaps([])}
                  style={{ flex: 1 }}
                />
              </View>
            </View>

            <Button label={s.beatEdit.apply} disabled={busy || taps.length === 0} onPress={() => void apply()} />
          </Section>

          <Section n={2} title={s.beatEdit.s2Title} text={s.beatEdit.s2Text}>
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button kind="secondary" label={s.beatEdit.double} disabled={!hasBeats || busy} onPress={() => doubleBeats(id)} style={{ flex: 1 }} />
                <Button kind="secondary" label={s.beatEdit.half} disabled={!hasBeats || busy} onPress={() => void halve()} style={{ flex: 1 }} />
              </View>
              <Button
                kind="secondary"
                label={s.beatEdit.setDownbeat}
                disabled={!hasBeats || busy || !isPlaying}
                onPress={() => setArm(!armed)}
              />
            </View>
          </Section>

          <Section n={3} title={s.beatEdit.s3Title} text={s.beatEdit.s3Text}>
            <Button kind="secondary" label={busy ? s.beatEdit.applying : s.beatEdit.reset} disabled={busy} onPress={() => void reset()} />
          </Section>
        </ScrollView>
      </SafeAreaView>
      <PromptHost />
    </Paper>
  );
}

function Section({ n, title, text, children }: { n: number; title: string; text: string; children: ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <T variant="headline" accessibilityRole="header">{`${n}. ${title}`}</T>
        <T variant="footnote">{text}</T>
      </View>
      {children}
    </View>
  );
}
