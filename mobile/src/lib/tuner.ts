import { s } from '../i18n';

/** Pitch math for the tuner (same logic as the desktop Tuner). */
export const NOTE_NAMES = s.notation.pitchClasses;
export const IN_TUNE_CENTS = 5;

function nearestMidi(midiFloat: number, pitchClass: number): number {
  const base = Math.round(midiFloat);
  let best = base - 6;
  let bestDist = Infinity;
  for (let k = base - 6; k <= base + 6; k++) {
    if (((k % 12) + 12) % 12 === pitchClass) {
      const d = Math.abs(midiFloat - k);
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
  }
  return best;
}

/** Keeps the previously shown note until the pitch is clearly closer to another one (no flicker near ±50 cents). */
export function nearestMidiWithHysteresis(midiFloat: number, prev: number | null): number {
  if (prev !== null && Math.abs(midiFloat - prev) < 0.62) return prev;
  return Math.round(midiFloat);
}

export type NoteReading = { name: string; octave: number; cents: number; midi: number };

/**
 * Auto: the note identity comes from the A=440 grid, the deviation is measured against the
 * user's A. With a target note: the nearest octave of that pitch class, deviation vs the user's A.
 */
export function readNote(frequency: number, refHz: number, target: number | 'auto', prevMidi: number | null = null, offsets?: number[]): NoteReading {
  const midiFloat = 69 + 12 * Math.log2(frequency / refHz);
  if (target === 'auto') {
    // Nearest note relative to the user's A (with A = 415, a played 415 Hz is A, not G♯ +100).
    const nearest = nearestMidiWithHysteresis(midiFloat, prevMidi);
    const pc = ((nearest % 12) + 12) % 12;
    return {
      name: NOTE_NAMES[pc],
      octave: Math.floor(nearest / 12) - 1,
      // The note is picked on the equal grid; the deviation is measured from its tempered pitch.
      cents: Math.round(100 * (midiFloat - nearest) - (offsets?.[pc] ?? 0)),
      midi: nearest,
    };
  }
  const k = nearestMidi(midiFloat, target);
  return { name: NOTE_NAMES[target], octave: Math.floor(k / 12) - 1, cents: Math.round(100 * (midiFloat - k) - (offsets?.[target] ?? 0)), midi: k };
}

const centsBetween = (a: number, b: number) => 1200 * Math.log2(a / b);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const spreadCents = (xs: number[]) => centsBetween(Math.max(...xs), Math.min(...xs));

const MIN_HZ = 40;
const MAX_HZ = 2000;
const CLARITY_LOCK = 0.85;
const CLARITY_HOLD = 0.65;
const HOLD_MS = 600;

/**
 * Turns the raw detector readings into a stable pitch to display. Noisy frames never blank the display,
 * a note change snaps after 3 agreeing readings (no glide through intermediate notes), and single
 * octave glitches are ignored. `push` returns the frequency to show, or -1 for "no signal".
 */
export function createPitchTracker(): { push(frequency: number, clarity: number, now: number): number; reset(): void } {
  let current = -1;
  let lastAccepted = 0;
  let pending: number[] = []; // seeding a lock
  let inNote: number[] = []; // last in-note readings
  let candidates: number[] = []; // readings far from `current`
  let octaveRun = 0;

  const reset = () => {
    current = -1;
    lastAccepted = 0;
    pending = [];
    inNote = [];
    candidates = [];
    octaveRun = 0;
  };

  const push = (frequency: number, clarity: number, now: number): number => {
    const locked = current > 0;
    const accepted = frequency >= MIN_HZ && frequency <= MAX_HZ && clarity >= (locked ? CLARITY_HOLD : CLARITY_LOCK);
    if (!accepted) {
      if ((locked || pending.length > 0) && now - lastAccepted > HOLD_MS) reset();
      return current;
    }
    if (!locked && pending.length > 0 && now - lastAccepted > HOLD_MS) pending = [];
    lastAccepted = now;

    if (!locked) {
      if (pending.length > 0 && Math.abs(centsBetween(frequency, pending[0])) <= 30) {
        current = (pending[0] + frequency) / 2;
        inNote = [pending[0], frequency];
        pending = [];
      } else {
        pending = [frequency];
      }
      return current;
    }

    const d = centsBetween(frequency, current);
    if (Math.abs(d) <= 50) {
      inNote.push(frequency);
      if (inNote.length > 5) inNote.shift();
      current += 0.3 * (median(inNote) - current);
      candidates = [];
      octaveRun = 0;
      return current;
    }

    // Octave errors (exactly ±12 semitones away) are dropped unless they persist.
    if (Math.abs(Math.abs(d) - 1200) <= 25) {
      octaveRun++;
      if (octaveRun < 6) return current;
    } else {
      octaveRun = 0;
    }
    candidates.push(frequency);
    if (candidates.length > 3) candidates.shift();
    if (candidates.length === 3 && spreadCents(candidates) <= 30) {
      current = median(candidates);
      inNote = [...candidates];
      candidates = [];
      octaveRun = 0;
    }
    return current;
  };

  return { push, reset };
}
