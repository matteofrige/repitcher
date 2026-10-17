import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, View, type GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as RepitchAudio from '../../modules/repitch-audio';
import { Button, tick } from '../components/Controls';
import { Paper } from '../components/Paper';
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
  const { follow } = useTools();

  const [taps, setTaps] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);

  if (!track) return <Paper />;
  const id = track.id;

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
            setStatus(s.beatEdit.setDownbeatDone);
          }
          setArm(false);
          return;
        }
        setTaps((cur) => insertSorted(cur, pos));
        setStatus(null);
      })
      .catch(() => {});
  };

  const apply = async () => {
    if (busy) return;
    if (taps.length === 0) {
      setStatus(s.beatEdit.noTaps);
      return;
    }
    setBusy(true);
    setStatus(s.beatEdit.applying);
    try {
      setBeatAnchors(id, mergeAnchors(track.beats?.anchors ?? [], taps));
      const r = await reanalyseBeats(id);
      if (!r) {
        setStatus(s.beatEdit.applyFailed);
      } else {
        setTaps([]);
        setStatus(r.bpm > 0 ? s.beatEdit.applied(Math.round(r.bpm)) : s.beatEdit.appliedNoBpm);
      }
    } catch (e) {
      console.warn('RePitch: beat re-analysis failed', e);
      setStatus(s.beatEdit.applyFailed);
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
      setStatus(null);
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
    setStatus(s.beatEdit.applying);
    try {
      const r = await resetBeats(id);
      setStatus(r ? (r.bpm > 0 ? s.beatEdit.applied(Math.round(r.bpm)) : s.beatEdit.appliedNoBpm) : s.beatEdit.applyFailed);
    } finally {
      setBusy(false);
    }
  };

  const hasBeats = !!track.beats && track.beats.times.length > 0;

  return (
    <Paper>
      <SafeAreaView style={{ flex: 1 }} edges={Platform.OS === 'android' ? ['top', 'bottom'] : ['bottom']}>
        <ScreenHeader
          inModal
          title={s.beatEdit.title}
          right={<HeaderTextButton label={s.beatEdit.done} bold onPress={() => router.back()} />}
        />
        <ScrollView contentContainerStyle={[{ padding: 20, paddingBottom: 48, gap: 18 }, column(560)]}>
          <T variant="body">{s.beatEdit.intro}</T>

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

          <Button label={busy ? s.beatEdit.applying : s.beatEdit.apply} disabled={busy || taps.length === 0} onPress={() => void apply()} />

          {status || busy ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 }} accessibilityLiveRegion="polite">
              {busy ? <ActivityIndicator size="small" color={colors.inkSecondary} /> : null}
              {status ? <T variant="footnote">{status}</T> : null}
            </View>
          ) : null}

          {!follow ? <T variant="footnote">{s.beatEdit.followOff}</T> : null}

          <View style={{ gap: 10, paddingTop: 6 }}>
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
            <Button kind="secondary" label={s.beatEdit.reset} disabled={busy} onPress={() => void reset()} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Paper>
  );
}
