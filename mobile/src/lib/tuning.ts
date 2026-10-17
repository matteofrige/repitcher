import { s as str } from '../i18n';

/** `refHz` is "il mio La": the tuning of the user's instrument (the target). */
export type Tuning = { semitones: number; cents: number; refHz: number };
/** Per-track exception: only the transposition; the A comes from the global "mio La". */
export type TrackTuning = { semitones: number; cents: number };

export const NEUTRAL_TUNING: Tuning = { semitones: 0, cents: 0, refHz: 440 };
export const MIN_REF_HZ = 392;
export const MAX_REF_HZ = 465;
export const REF_PRESETS = [392, 415, 430, 432, 440, 442, 443, 446, 465] as const;
/** Small captions under some presets in the "Il La del tuo strumento" chips. */
export const REF_PRESET_LABELS: Partial<Record<number, string>> = str.tuning.presetCaptions;
export const MAX_SEMITONES = 12;
export const MAX_CENTS = 50;

const MINUS = '−';

/** semitones + cents/100 + 12·log2(mioLa / laDelBrano). `sourceHz` is the track's own A. */
export function totalSemitones({ semitones, cents, refHz }: Tuning, sourceHz = 440): number {
  return semitones + cents / 100 + 12 * Math.log2(refHz / sourceHz);
}

/** Correction in cents that aligns the track's A to the user's A. */
export function correctionCents(myLa: number, sourceHz: number): number {
  return 1200 * Math.log2(myLa / sourceHz);
}

/** The detector is accurate to about 0.5 Hz: show whole hertz. */
export function formatHz(hz: number): string {
  return Math.round(hz).toString();
}

export function isNeutral(t: Tuning): boolean {
  return t.semitones === 0 && t.cents === 0 && t.refHz === 440;
}

/** Signed integer with a real minus sign: "+3", "−12", "0". */
export function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${MINUS}${Math.abs(n)}`;
  return '0';
}

/** Pencil annotation, e.g. "+2 · −12¢ · La 432". Empty string when neutral. */
export function formatAnnotation(t: Tuning): string {
  const parts: string[] = [];
  if (t.semitones !== 0) parts.push(signed(t.semitones));
  if (t.cents !== 0) parts.push(`${signed(t.cents)}¢`);
  if (t.refHz !== 440) parts.push(str.tuning.annotationRef(t.refHz));
  return parts.join(' · ');
}

/** Annotation for a per-track override; a neutral override reads "originale". */
export function formatOverride(t: TrackTuning): string {
  return formatAnnotation({ ...t, refHz: 440 }) || str.tuning.original;
}

/** Spoken form, e.g. "più 2 semitoni, meno 12 cents, La a 432 hertz". */
export function formatAccessibility(t: Tuning): string {
  const parts: string[] = [];
  if (t.semitones !== 0) parts.push(str.tuning.spokenSemitones(t.semitones));
  if (t.cents !== 0) parts.push(str.tuning.spokenCents(t.cents));
  if (t.refHz !== 440) parts.push(str.tuning.spokenRef(t.refHz));
  return parts.length ? parts.join(', ') : str.tuning.neutralSpoken;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = sec.toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "12 brani · 48 min" */
export function formatPlaylistSummary(count: number, seconds: number): string {
  const n = str.playlists.tracks(count);
  const min = Math.round(seconds / 60);
  return seconds > 0 ? `${n} · ${str.playlists.minutes(min)}` : n;
}

// ---- notation: where does the reference A land after transposing? ----

const UP_NAMES = str.notation.up;
const UP_STEPS = [0, 0, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6, 7];
const DOWN_NAMES = str.notation.down;
const DOWN_STEPS = [0, 0, -1, -1, -2, -3, -3, -4, -4, -5, -6, -6, -7];

/** Staff step of A4 counted from E4 (bottom line) in half-spaces. */
const A4_STEP = 3;

export type StaffNote = {
  name: string;
  /** Half-spaces above the bottom line (E4 = 0). A4 = 3, A3 = −4, A5 = 10. */
  step: number;
  accidental: 'sharp' | 'flat' | null;
};

/** Sharps going up, flats going down; spans A3 (−12) to A5 (+12), integer semitones. */
export function noteForSemitones(semitones: number): StaffNote {
  const s = Math.max(-MAX_SEMITONES, Math.min(MAX_SEMITONES, Math.round(semitones)));
  const k = Math.abs(s);
  const name = s >= 0 ? UP_NAMES[k] : DOWN_NAMES[k];
  const step = A4_STEP + (s >= 0 ? UP_STEPS[k] : DOWN_STEPS[k]);
  return { name, step, accidental: name.endsWith('♯') ? 'sharp' : name.endsWith('♭') ? 'flat' : null };
}

/** Caption under the staff: "Il La suona come Do", "… Fa♯ · −12 cents", "Intonazione originale". */
export function describeResult(t: Tuning): string {
  if (isNeutral(t)) return str.tuning.resultOriginal;
  const parts: string[] = [];
  if (t.semitones !== 0) parts.push(str.tuning.resultSoundsLike(noteForSemitones(t.semitones).name));
  else if (t.cents === 0) parts.push(str.tuning.resultYourA(t.refHz));
  else parts.push(str.tuning.resultSoundsLike(str.notation.a));
  if (t.cents !== 0) parts.push(`${signed(t.cents)} ${str.tuning.unitCents}`);
  if (t.semitones !== 0 && t.refHz !== 440) parts.push(str.tuning.resultYourAShort(t.refHz));
  return parts.join(' · ');
}

const semitoneUnit = (n: number) => `${signed(n)} ${str.tuning.semitoneWord(n)}`;
const centUnit = (n: number) => `${signed(n)} ${str.tuning.centWord(n)}`;

/** "+3 semitoni · −5 cents · tuo La 442 Hz" — the settings a track follows. */
export function formatSettingsSummary(t: { semitones: number; cents: number }, myLa: number): string {
  const parts: string[] = [];
  if (t.semitones !== 0) parts.push(semitoneUnit(t.semitones));
  if (t.cents !== 0) parts.push(centUnit(t.cents));
  parts.push(str.tuning.settingsYourA(myLa));
  return parts.join(' · ');
}

/** What the listener really hears vs the original: transposition plus the A correction, in cents. */
export function formatResultLine(t: { semitones: number; cents: number }, myLa: number, sourceHz: number): string {
  const total = Math.round(t.semitones * 100 + t.cents + correctionCents(myLa, sourceHz));
  const st = Math.trunc(total / 100);
  const c = total - st * 100;
  if (st === 0 && c === 0) return str.tuning.resultSameAsOriginal;
  const parts: string[] = [];
  if (st !== 0) parts.push(semitoneUnit(st));
  if (c !== 0) parts.push(centUnit(c));
  return str.tuning.resultVsOriginal(parts);
}
