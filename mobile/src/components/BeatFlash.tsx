import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue } from 'react-native-reanimated';

import * as RepitchAudio from '../../modules/repitch-audio';
import { getTools, useTools } from '../lib/library';
import { useMetronome } from '../lib/metronome';
import { useColors } from '../theme';

/** One frame of lead: the frame being prepared reaches the glass about a frame (ProMotion) later. */
const LEAD_MS = 8;
const HOLD_MS = 75;
const FADE_MS = 45;
const MAX_ENTRIES = 8;
const MATCH_MS = 30;
const PEAK_ACCENT = 0.85;
const PEAK_NORMAL = 0.5;

/**
 * Whole-screen flash on each metronome beat (opt-in, meant to be seen from a music stand).
 * Native reports each beat *ahead of the sound* with the epoch time it will be heard (`atMs`); here the
 * upcoming times live in a shared value and a UI-thread frame callback draws against `Date.now()`, so a beat
 * costs no React render. The next beat is also predicted from the BPM, so a late/missed event still flashes.
 */
export function BeatFlash() {
  const { flash } = useTools();
  const { running } = useMetronome();
  const colors = useColors();
  const reduced = useReducedMotion();
  const enabled = flash && running;
  /** Flat pairs [atMs, peak, atMs, peak, ...], ascending by time. */
  const beats = useSharedValue<number[]>([]);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!enabled) {
      beats.set([]);
      opacity.set(0);
      return;
    }
    const sub = RepitchAudio.addMetronomeBeatListener((e) => {
      const { bpm, beatsPerBar } = getTools();
      const next = [{ at: e.atMs, peak: e.accent ? PEAK_ACCENT : PEAK_NORMAL }];
      next.push({
        at: e.atMs + 60000 / bpm,
        peak: (e.beat + 1) % beatsPerBar === 0 ? PEAK_ACCENT : PEAK_NORMAL,
      });
      const cutoff = Date.now() - 1000;
      const list: number[] = [];
      const old = beats.get();
      // Keep the existing entries, except predictions that this event (or its own prediction) supersedes.
      for (let i = 0; i < old.length; i += 2) {
        if (old[i] < cutoff) continue;
        if (next.some((n) => Math.abs(n.at - old[i]) <= MATCH_MS)) continue;
        list.push(old[i], old[i + 1]);
      }
      next.forEach((n) => list.push(n.at, n.peak));
      // Sort pairs by time, then cap.
      const pairs: [number, number][] = [];
      for (let i = 0; i < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
      pairs.sort((a, b) => a[0] - b[0]);
      beats.set(pairs.slice(-MAX_ENTRIES).flat());
    });
    return () => sub.remove();
  }, [enabled, beats, opacity]);

  const frame = useFrameCallback(() => {
    'worklet';
    const list = beats.get();
    const now = Date.now() + LEAD_MS;
    let value = 0;
    for (let i = list.length - 2; i >= 0; i -= 2) {
      if (list[i] > now) continue;
      const elapsed = now - list[i];
      const peak = list[i + 1];
      if (elapsed < HOLD_MS) value = peak;
      else if (reduced) value = elapsed < HOLD_MS + FADE_MS ? peak : 0; // Reduce Motion: still flash, no fade
      else if (elapsed < HOLD_MS + FADE_MS) value = peak * (1 - (elapsed - HOLD_MS) / FADE_MS);
      break;
    }
    if (opacity.get() !== value) opacity.set(value);
  }, false);
  // The second argument of useFrameCallback is only read on mount: (de)activate it explicitly.
  useEffect(() => {
    frame.setActive(enabled);
  }, [enabled, frame]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.tint }, style]} />;
}
