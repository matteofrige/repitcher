import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useState, useSyncExternalStore } from 'react';

import * as RepitchAudio from '../../modules/repitch-audio';
import { ensureBeats, getTools, getTrack, rephaseBeats, subscribeLibrary, type TrackBeats } from './library';
import { isMetronomeRunning, stopMetronome } from './metronome';
import { currentTrackId, isPlayerPlaying, subscribePlayer } from './player';

/** Metronome that follows the loaded track: click/flash on the beats found by the native tracker. */
type State = {
  /** Native is following the current track's beats. */
  active: boolean;
  analysing: boolean;
  /** 'invalid' = no clear beat in this track; 'failed' = analysis or start error. */
  error: 'invalid' | 'failed' | null;
  /** Following, but the tracker is not confident: the user should check by ear. */
  uncertain: boolean;
};
let state: State = { active: false, analysing: false, error: null, uncertain: false };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
  syncKeepAwake();
}

const KEEP_AWAKE_TAG = 'repitch-beat-follow';
let awake = false;
/** The screen stays on while the metronome follows a playing track (flash visible, no lock mid-practice). */
function syncKeepAwake() {
  const want = state.active && isPlayerPlaying();
  if (want === awake) return;
  awake = want;
  if (want) void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
  else void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
}

/** Track the user wants followed (follow on + loaded); null when off. */
let wantedId: string | null = null;
/** Track native is currently following. */
let startedFor: string | null = null;
let optionsKey = '';
let token = 0;
/** Beats native currently has (same `times` array + downbeat = nothing to resend). */
let startedTimes: number[] | null = null;
let startedDownbeat = 0;

function options(beats?: TrackBeats | null) {
  const t = getTools();
  return { clickAudible: t.followClick, beatsPerBar: t.beatsPerBar, downbeatIndex: beats?.downbeatIndex ?? 0, volume: t.volume / 100 };
}
const keyOf = (o: ReturnType<typeof options>) => `${o.clickAudible}|${o.beatsPerBar}|${o.downbeatIndex}|${o.volume}`;

function stopNative() {
  startedFor = null;
  startedTimes = null;
  void RepitchAudio.beatFollowStop().catch(() => {});
}

async function begin(id: string, mine: number) {
  const track = getTrack(id);
  if (!track) return;
  set({ active: false, analysing: !(track.beats && track.beatDetection === 'done'), error: null, uncertain: false });
  const beats = await ensureBeats(id);
  if (mine !== token) return;
  if (!beats) {
    set({ analysing: false, error: 'failed', uncertain: false });
    return;
  }
  if (!beats.valid) {
    set({ analysing: false, error: 'invalid', uncertain: false });
    return;
  }
  const o = options(beats);
  try {
    if (isMetronomeRunning()) await stopMetronome();
    if (mine !== token) return;
    startedFor = id;
    optionsKey = keyOf(o);
    startedTimes = beats.times;
    startedDownbeat = beats.downbeatIndex;
    await RepitchAudio.beatFollowStart(beats.times, o.beatsPerBar, o.downbeatIndex, o.clickAudible, o.volume);
    if (mine !== token) return;
    set({ active: true, analysing: false, error: null, uncertain: beats.uncertain });
  } catch (e) {
    console.warn('RePitch: beat follow start failed', e);
    if (mine !== token) return;
    startedFor = null;
    startedTimes = null;
    set({ active: false, analysing: false, error: 'failed', uncertain: false });
  }
}

/** Brings the native side in line with settings + current track. Cheap: called on every library/player change. */
function reconcile() {
  syncKeepAwake();
  const id = currentTrackId() ?? null;
  // A new meter moves the automatic "1" (from the cached activation); the update comes back through the library.
  if (id !== null) void rephaseBeats(id);
  const want = RepitchAudio.beatFollowAvailable() && getTools().follow && id !== null ? id : null;
  if (want === wantedId) {
    if (startedFor === null && want !== null && state.error === 'invalid' && getTrack(want)?.beats?.valid) {
      // A refused track became followable after the user's corrections (taps).
      void begin(want, ++token);
      return;
    }
    if (startedFor !== null && startedFor === want) {
      const beats = getTrack(want)?.beats ?? null;
      if (beats && beats.valid && (beats.times !== startedTimes || beats.downbeatIndex !== startedDownbeat)) {
        // The beats were edited (re-analysis, double/half, downbeat): native resyncs on a running follow.
        const o = options(beats);
        const mine = ++token;
        startedTimes = beats.times;
        startedDownbeat = beats.downbeatIndex;
        optionsKey = keyOf(o);
        set({ uncertain: beats.uncertain });
        void RepitchAudio.beatFollowStart(beats.times, o.beatsPerBar, o.downbeatIndex, o.clickAudible, o.volume).catch((e) => {
          console.warn('RePitch: beat follow restart failed', e);
          if (mine === token) set({ active: false, error: 'failed' });
        });
        return;
      }
      const o = options(beats);
      const key = keyOf(o);
      if (key !== optionsKey) {
        optionsKey = key;
        void RepitchAudio.beatFollowConfigure(o.clickAudible, o.beatsPerBar, o.downbeatIndex, o.volume).catch(() => {});
      }
    }
    return;
  }
  wantedId = want;
  const mine = ++token;
  // Beats belong to one track: stop at once so the old ones never click over the new track.
  if (startedFor !== null) stopNative();
  if (want === null) {
    set({ active: false, analysing: false, error: null, uncertain: false });
    return;
  }
  void begin(want, mine);
}

let wired = false;
export function initBeatFollow() {
  if (wired) return;
  wired = true;
  subscribeLibrary(reconcile);
  subscribePlayer(reconcile);
  reconcile();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export const useBeatFollow = () => useSyncExternalStore(subscribe, () => state, () => state);

/** Re-runs the detection / start for the wanted track (e.g. after a failed analysis). */
export function retryBeatFollow() {
  if (wantedId !== null && startedFor !== wantedId) void begin(wantedId, ++token);
}

/** Bar position (0-based) of the beat currently sounding while following, else -1. */
export function useFollowBeat(enabled: boolean): number {
  const [active, setActive] = useState(-1);
  useEffect(() => {
    if (!enabled) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const sub = RepitchAudio.addMetronomeBeatListener((e) => {
      if (!e.follow) return;
      const t = setTimeout(() => {
        timers.delete(t);
        setActive(e.beat);
      }, Math.max(0, e.atMs - Date.now()));
      timers.add(t);
    });
    return () => {
      sub.remove();
      timers.forEach(clearTimeout);
      timers.clear();
      setActive(-1);
    };
  }, [enabled]);
  return enabled ? active : -1;
}
