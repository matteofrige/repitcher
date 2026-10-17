import { router, useLocalSearchParams, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, type ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { s } from '../i18n';
import { IconButton } from '../components/Controls';
import { Paper } from '../components/Paper';
import { Toggle } from '../components/Toggle';
import { SheetStatusBar } from '../components/SheetStatusBar';
import { SeekBar } from '../components/SeekBar';
import { FineTuneControl, TranspositionControl } from '../components/TuningControls';
import * as RepitchAudio from '../../modules/repitch-audio';
import { useBeatFollow } from '../lib/beatFollow';
import { effectiveTuning, setTools, sourceHzOf, useGlobalTuning, useTools, useTrack } from '../lib/library';
import { formatResultLine, formatSettingsSummary } from '../lib/tuning';
import { SourceLa } from '../components/SourceLa';
import {
  next,
  playTrack,
  previous,
  seek,
  setCurrentOverride,
  toggle,
  usePlayer,
  usePlayerProgress,
} from '../lib/player';
import { useColors } from '../theme';
import { column } from '../theme/layout';
import { T } from '../theme/type';
import { sym } from '../lib/icons';

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

/** Metronome that follows the track's own beats (hidden where the platform has no beat tracker). */
function BeatFollowSection({ bpm }: { bpm: number | null }) {
  const { follow, followClick, followFlash } = useTools();
  const { active, analysing, error, uncertain } = useBeatFollow();
  const colors = useColors();
  if (!RepitchAudio.beatFollowAvailable()) return null;
  const status = analysing
    ? s.beatFollow.analysing
    : error === 'invalid'
      ? s.beatFollow.invalid
      : error === 'failed'
        ? s.beatFollow.failed
        : active && bpm
          ? uncertain
            ? s.beatFollow.uncertain
            : s.beatFollow.following(Math.round(bpm))
          : null;
  const row = { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 } as const;
  return (
    <View
      style={{
        gap: 4,
        paddingTop: 14,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.rule,
      }}>
      <View style={row}>
        <T variant="headline" accessibilityRole="header" style={{ flex: 1 }}>
          {s.beatFollow.title}
        </T>
        <Toggle value={follow} accessibilityLabel={s.beatFollow.toggleA11y} onValueChange={(v) => setTools({ follow: v })} />
      </View>
      {follow ? (
        <View style={{ gap: 2, paddingLeft: 12 }}>
          <View style={row}>
            <T variant="callout">{s.beatFollow.click}</T>
            <Toggle value={followClick} accessibilityLabel={s.beatFollow.clickA11y} onValueChange={(v) => setTools({ followClick: v })} />
          </View>
          <View style={row}>
            <T variant="callout">{s.beatFollow.flash}</T>
            <Toggle value={followFlash} accessibilityLabel={s.beatFollow.flashA11y} onValueChange={(v) => setTools({ followFlash: v })} />
          </View>
          {status ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 }} accessibilityLiveRegion="polite">
              {analysing ? <ActivityIndicator size="small" color={colors.inkSecondary} /> : null}
              <T variant="footnote" tone={error ? 'danger' : undefined}>
                {status}
              </T>
            </View>
          ) : null}
          {!analysing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.beatFollow.correctA11y}
              onPress={() => router.push('/beat-edit' as Href)}
              style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', opacity: pressed ? 0.55 : 1 })}>
              <T variant="callout" tone="tint">
                {s.beatFollow.correct}
              </T>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function PlayerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { queue, index, sourceLabel, isPlaying, loading, error } = usePlayer();
  const { position, duration } = usePlayerProgress();
  const id = queue[index];
  const track = useTrack(id);
  const global = useGlobalTuning(); // re-render when the global tuning changes

  // Deep link: repitch:///player?trackId=<id> starts that track (used by the screenshot script too).
  // `close=1` starts playback and dismisses the sheet (screenshot of the docked mini-player).
  const { trackId, close } = useLocalSearchParams<{ trackId?: string; close?: string }>();
  const linked = useTrack(trackId);
  useEffect(() => {
    if (linked && linked.id !== id) playTrack([linked.id], 0, s.library.fromLibrary);
  }, [linked, id]);
  useEffect(() => {
    if (close !== '1' || !track) return;
    const t = setTimeout(() => router.back(), 600);
    return () => clearTimeout(t);
  }, [close, track]);

  useEffect(() => {
    if (!track && !trackId) router.back();
  }, [track, trackId]);

  if (!track) return <Paper />;

  const own = track.override !== null;
  const tuning = effectiveTuning(track);
  const myLa = global.refHz;
  const onOwnChange = ({ semitones, cents }: { semitones?: number; cents?: number }) =>
    setCurrentOverride({
      ...(semitones !== undefined && { semitones }),
      ...(cents !== undefined && { cents }),
    });
  const atEnd = index + 1 >= queue.length;

  return (
    <Paper>
      <SheetStatusBar />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          ...column(560),
          paddingHorizontal: 20,
          // Android: a full-screen edge-to-edge screen, not an iOS sheet: no grabber, clear the status bar.
          paddingTop: Platform.OS === 'android' ? insets.top + 16 : 8,
          paddingBottom: 16,
          gap: 20,
        }}>
        {Platform.OS === 'ios' ? (
          <View
            accessible={false}
            style={{
              alignSelf: 'center',
              width: 36,
              height: 5,
              borderRadius: 3,
              backgroundColor: colors.inkSecondary,
              opacity: 0.4,
            }}
          />
        ) : (
          // Android: no sheet grabber and no header, so give the full-screen player a visible way out
          // (the system back gesture works too).
          <IconButton
            symbol={sym('chevron.down')}
            label={s.common.close}
            tone="ink"
            onPress={() => router.back()}
            style={{ alignSelf: 'flex-start', marginLeft: -12, marginBottom: -12 }}
          />
        )}
        <View style={{ gap: 4 }}>
          <T
            variant="title"
            numberOfLines={2}
            accessibilityRole="header"
            style={{ fontSize: 28, lineHeight: 34, textAlign: 'center' }}>
            {track.title}
          </T>
          {sourceLabel ? (
            <T variant="annotation" style={{ textAlign: 'center' }}>
              {sourceLabel}
            </T>
          ) : null}
        </View>

        <View
          style={{
            gap: 2,
            alignItems: 'center',
            paddingVertical: 10,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderColor: colors.rule,
          }}>
          <T variant="headline" style={{ textAlign: 'center' }}>
            {own ? s.player.ownSettings : s.player.globalSettings}
          </T>
          <T variant="annotation" style={{ textAlign: 'center' }}>
            {formatSettingsSummary(tuning, myLa)}
          </T>
          {own ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.player.backToGlobalA11y}
              onPress={() => setCurrentOverride(null)}
              style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
              <T variant="callout" tone="tint">
                {s.player.backToGlobal}
              </T>
            </Pressable>
          ) : null}
        </View>

        <Section n={1} title={s.player.sourceTitle} text={s.player.sourceText(myLa)}>
          <SourceLa track={track} myLa={myLa} />
        </Section>

        <Section
          n={2}
          title={s.player.transposeTitle}
          text={s.player.transposeText}>
          {/* `tuning.refHz` is the user's A: the staff label and caption read "La 442" like the Intonazione
              tab, instead of a misleading "La 440". Only semitones/cents are editable here. */}
          <TranspositionControl value={tuning} onChange={onOwnChange} />
        </Section>

        <Section
          n={3}
          title={s.player.fineTitle}
          text={s.player.fineText}>
          <FineTuneControl value={tuning} onChange={onOwnChange} />
        </Section>

        <T variant="callout" style={{ textAlign: 'center' }}>
          {formatResultLine(tuning, myLa, sourceHzOf(track))}
        </T>

        <BeatFollowSection bpm={track.beats?.valid ? track.beats.bpm : null} />
      </ScrollView>
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 16),
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.rule,
        }}>
        <View style={[{ gap: 12 }, column(560)]}>
        {error ? (
          <T variant="body" tone="danger" style={{ textAlign: 'center' }}>
            {error}
          </T>
        ) : null}

        <SeekBar position={position} duration={duration} onSeek={(s) => void seek(s)} />

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
          <IconButton
            symbol={sym('backward.end.fill')}
            label={s.common.previousTrack}
            tone="ink"
            size={28}
            hit={56}
            onPress={previous}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? s.common.pause : s.common.play}
            onPress={() => void toggle()}
            style={({ pressed }) => ({
              width: 72,
              height: 72,
              borderRadius: 36,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? colors.tintPressed : colors.tint,
            })}>
            {loading ? (
              <ActivityIndicator color={colors.paper} />
            ) : (
              <SymbolView
                name={isPlaying ? sym('pause.fill') : sym('play.fill')}
                size={30}
                tintColor={colors.paper}
                resizeMode="scaleAspectFit"
              />
            )}
          </Pressable>
          <IconButton
            symbol={sym('forward.end.fill')}
            label={s.common.nextTrack}
            tone="ink"
            size={28}
            hit={56}
            disabled={atEnd}
            onPress={next}
          />
        </View>
        </View>
      </View>
    </Paper>
  );
}
