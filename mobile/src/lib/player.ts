import { useEffect, useSyncExternalStore } from 'react';

import * as RepitchAudio from '../../modules/repitch-audio';
import { localizedError } from './errors';
import {
  getGlobalTuning,
  getTrack,
  setGlobalTuning,
  setGlobalTuningHandler,
  setTrackDuration,
  setTrackOverride,
  setTrackChangedHandler,
  setTrackRemovedHandler,
  trackPitch,
  trackUri,
} from './library';
import type { TrackTuning, Tuning } from './tuning';

type PlayerState = {
  queue: string[];
  index: number;
  sourceLabel: string;
  isPlaying: boolean;
  loading: boolean;
  error: string | null;
};

let state: PlayerState = {
  queue: [],
  index: -1,
  sourceLabel: '',
  isPlaying: false,
  loading: false,
  error: null,
};
const listeners = new Set<() => void>();
let loadToken = 0;

type Progress = { position: number; duration: number };
let progress: Progress = { position: 0, duration: 0 };
const progressListeners = new Set<() => void>();

function set(patch: Partial<PlayerState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
function setProgress(p: Progress) {
  progress = p;
  progressListeners.forEach((l) => l());
}

export function currentTrackId(): string | undefined {
  return state.queue[state.index];
}

async function loadAt(index: number, autoplay: boolean) {
  const id = state.queue[index];
  const track = id ? getTrack(id) : undefined;
  if (!track) return;
  const token = ++loadToken;
  set({ index, loading: true, error: null });
  setProgress({ position: 0, duration: track.duration });
  try {
    const { duration } = await RepitchAudio.load(trackUri(track), track.title);
    if (token !== loadToken) return;
    setTrackDuration(track.id, duration);
    setProgress({ position: 0, duration });
    await RepitchAudio.setPitch(trackPitch(track));
    if (token !== loadToken) return;
    set({ loading: false });
    if (autoplay) await RepitchAudio.play();
  } catch (e) {
    if (token !== loadToken) return;
    set({ loading: false, isPlaying: false, error: localizedError(e) });
  }
}

// ---- public controls ----

export function playTrack(trackIds: string[], index: number, sourceLabel: string) {
  if (!trackIds[index]) return;
  set({ queue: trackIds, sourceLabel });
  void loadAt(index, true);
}

export async function toggle() {
  if (state.index < 0 || state.loading) return;
  try {
    if (state.isPlaying) await RepitchAudio.pause();
    else await RepitchAudio.play();
  } catch (e) {
    set({ error: localizedError(e) });
  }
}

export function next() {
  if (state.index + 1 < state.queue.length) void loadAt(state.index + 1, true);
}

export function previous() {
  if (state.index < 0) return;
  if (progress.position > 3 || state.index === 0) {
    void seek(0);
  } else {
    void loadAt(state.index - 1, true);
  }
}

export async function seek(seconds: number) {
  if (state.index < 0) return;
  const clamped = Math.max(0, Math.min(progress.duration || seconds, seconds));
  setProgress({ ...progress, position: clamped });
  try {
    await RepitchAudio.seek(clamped);
  } catch {}
}

function applyCurrentPitch() {
  const id = currentTrackId();
  const track = id ? getTrack(id) : undefined;
  if (track) void RepitchAudio.setPitch(trackPitch(track)).catch(() => {});
}

/** Edits the global tuning; applied live if the current track follows it. */
export function setGlobal(patch: Partial<Tuning>) {
  setGlobalTuning(patch);
}

/**
 * Edits the current track's own tuning, creating the override from the global one
 * if needed. `null` drops the override (back to the global tuning).
 */
export function setCurrentOverride(patch: Partial<TrackTuning> | null) {
  const id = currentTrackId();
  const track = id ? getTrack(id) : undefined;
  if (!track) return;
  if (patch === null) {
    setTrackOverride(track.id, null);
  } else {
    const base = track.override ?? getGlobalTuning();
    setTrackOverride(track.id, { semitones: base.semitones, cents: base.cents, ...patch });
  }
  applyCurrentPitch();
}

export function stopAndClear() {
  loadToken++;
  void RepitchAudio.pause().catch(() => {});
  set({ queue: [], index: -1, sourceLabel: '', isPlaying: false, loading: false });
  setProgress({ position: 0, duration: 0 });
}

// ---- wiring (module scope, runs once) ----

let wired = false;
export function initPlayer() {
  if (wired) return;
  wired = true;
  RepitchAudio.addProgressListener((e) => setProgress({ position: e.position, duration: e.duration }));
  RepitchAudio.addPlayingChangeListener((e) => set({ isPlaying: e.isPlaying }));
  RepitchAudio.addTrackEndListener(() => next());
  RepitchAudio.addRemoteNextListener(() => next());
  RepitchAudio.addRemotePreviousListener(() => previous());

  setGlobalTuningHandler(applyCurrentPitch);
  setTrackChangedHandler((id) => {
    if (id === currentTrackId()) applyCurrentPitch();
  });
  setTrackRemovedHandler((id) => {
    const cur = currentTrackId();
    const queue = state.queue.filter((q) => q !== id);
    if (cur !== id) {
      set({ queue, index: cur ? queue.indexOf(cur) : -1 });
      return;
    }
    const idx = state.index;
    if (queue.length === 0) {
      stopAndClear();
    } else {
      // Move to the neighbour, but only keep playing if the deleted track was playing.
      set({ queue });
      void loadAt(Math.min(idx, queue.length - 1), state.isPlaying);
    }
  });
}

// ---- hooks ----

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
/** Non-React subscription to player state changes (track, playing, loading...). */
export function subscribePlayer(l: () => void) {
  return subscribe(l);
}
export function usePlayer(): PlayerState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
export function usePlayingTrackId(): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => state.queue[state.index],
    () => undefined,
  );
}
export function usePlayerProgress(): Progress {
  return useSyncExternalStore(
    (l) => {
      progressListeners.add(l);
      return () => {
        progressListeners.delete(l);
      };
    },
    () => progress,
    () => progress,
  );
}
/** Convenience: ensures wiring when mounted in the root. */
export function useInitPlayer() {
  useEffect(() => {
    initPlayer();
  }, []);
}
