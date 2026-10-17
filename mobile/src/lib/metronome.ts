import { useSyncExternalStore } from 'react';

import { getTools, setTools, type ToolsSettings } from './library';
import * as RepitchAudio from '../../modules/repitch-audio';

type State = { running: boolean; activeBeat: number; flashTick: number };
let state: State = { running: false, activeBeat: -1, flashTick: 0 };
const listeners = new Set<() => void>();
let offTimer: ReturnType<typeof setTimeout> | null = null;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function configure() {
  const { bpm, beatsPerBar, volume } = getTools();
  void RepitchAudio.metronomeConfigure({ bpm, beatsPerBar, volume: volume / 100 }).catch(() => {});
}

export function setMetronome(patch: Partial<Pick<ToolsSettings, 'bpm' | 'beatsPerBar' | 'volume'>>) {
  setTools(patch);
  configure();
}

export async function startMetronome() {
  configure();
  try {
    await RepitchAudio.metronomeStart();
    set({ running: true });
  } catch (e) {
    console.warn('RePitch: metronome start failed', e);
  }
}

export async function stopMetronome() {
  try {
    await RepitchAudio.metronomeStop();
  } finally {
    if (offTimer) clearTimeout(offTimer);
    set({ running: false, activeBeat: -1 });
  }
}

export function toggleMetronome() {
  return state.running ? stopMetronome() : startMetronome();
}

let wired = false;
export function initMetronome() {
  if (wired) return;
  wired = true;
  RepitchAudio.addMetronomeBeatListener((e) => {
    if (offTimer) clearTimeout(offTimer);
    set({ activeBeat: e.beat, flashTick: state.flashTick + 1 });
    offTimer = setTimeout(() => set({ activeBeat: -1 }), 120);
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export const useMetronome = () => useSyncExternalStore(subscribe, () => state, () => state);
