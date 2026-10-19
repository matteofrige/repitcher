/**
 * Tuning systems for the tuner. Every temperament is a table of 12 deviations in cents from equal
 * temperament, indexed by pitch class from the tonic (0 = tonic). The user's A stays the reference:
 * offsets are shifted so that A is always 0 cents (A = "il mio La", whatever the temperament).
 */

const PYTHAGOREAN_COMMA = 1200 * Math.log2(531441 / 524288); // 23.46
const SYNTONIC_COMMA = 1200 * Math.log2(81 / 80); // 21.51
const SCHISMA = PYTHAGOREAN_COMMA - SYNTONIC_COMMA; // 1.95
const PURE_FIFTH_EXCESS = 1200 * Math.log2(3 / 2) - 700; // 1.955

export type TemperamentId =
  | 'equal'
  | 'pythagorean'
  | 'meantone4'
  | 'meantone6'
  | 'werckmeister3'
  | 'kirnberger3'
  | 'vallotti'
  | 'young2'
  | 'just'
  | 'custom';

export const TEMPERAMENT_IDS: TemperamentId[] = [
  'equal',
  'pythagorean',
  'meantone4',
  'meantone6',
  'werckmeister3',
  'kirnberger3',
  'vallotti',
  'young2',
  'just',
  'custom',
];

/**
 * A circulating/regular temperament from the tempering of its fifths, in cents vs a pure fifth, along
 * the chain tonic→V→II→VI→III→VII→♯IV→♯I→♯V→♭III→♭VII→IV→tonic. `null` marks the fifth that closes the
 * circle (the wolf, or the last tempered fifth): it absorbs whatever is left of the Pythagorean comma.
 */
function fromFifths(devs: (number | null)[]): number[] {
  const known = devs.reduce<number>((a, d) => a + (d ?? 0), 0);
  const filled = devs.map((d) => d ?? -PYTHAGOREAN_COMMA - known);
  const out = new Array<number>(12).fill(0);
  let pos = 0;
  for (let k = 0; k < 12; k++) {
    out[(7 * k) % 12] = pos;
    pos += PURE_FIFTH_EXCESS + filled[k];
  }
  return out;
}

const fromRatios = (ratios: number[]) => ratios.map((r, i) => 1200 * Math.log2(r) - 100 * i);

const P = PYTHAGOREAN_COMMA;
const S = SYNTONIC_COMMA;

/** Deviations from equal temperament, cents, index = semitones above the tonic. */
const TABLES: Record<Exclude<TemperamentId, 'custom'>, number[]> = {
  equal: new Array<number>(12).fill(0),
  // 11 pure fifths, the wolf between ♯V and ♭III.
  pythagorean: fromFifths([0, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 0]),
  meantone4: fromFifths([-S / 4, -S / 4, -S / 4, -S / 4, -S / 4, -S / 4, -S / 4, -S / 4, null, -S / 4, -S / 4, -S / 4]),
  meantone6: fromFifths([-S / 6, -S / 6, -S / 6, -S / 6, -S / 6, -S / 6, -S / 6, -S / 6, null, -S / 6, -S / 6, -S / 6]),
  // C–G, G–D, D–A, B–F♯ tempered by ¼ comma.
  werckmeister3: fromFifths([-P / 4, -P / 4, -P / 4, 0, 0, null, 0, 0, 0, 0, 0, 0]),
  // C–G–D–A–E by ¼ syntonic comma, F♯–C♯ by a schisma.
  kirnberger3: fromFifths([-S / 4, -S / 4, -S / 4, -S / 4, 0, 0, -SCHISMA, 0, 0, 0, 0, null]),
  // F–C–G–D–A–E–B by ⅙ comma.
  vallotti: fromFifths([-P / 6, -P / 6, -P / 6, -P / 6, -P / 6, 0, 0, 0, 0, 0, 0, null]),
  // C–G–D–A–E–B–F♯ by ⅙ comma.
  young2: fromFifths([-P / 6, -P / 6, -P / 6, -P / 6, -P / 6, null, 0, 0, 0, 0, 0, 0]),
  // 5-limit just intonation on the tonic.
  just: fromRatios([1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8]),
};

/** Temperaments where the tonic matters (all except equal and the custom table, which is per note name). */
export const hasTonic = (id: TemperamentId) => id !== 'equal' && id !== 'custom';

export type TemperamentSettings = {
  temperament: TemperamentId;
  /** Pitch class of the tonic, 0 = C. */
  temperamentTonic: number;
  /** Custom table: cents vs equal temperament for each pitch class from C. */
  customCents: number[];
};

export const DEFAULT_TEMPERAMENT: TemperamentSettings = {
  temperament: 'equal',
  temperamentTonic: 0,
  customCents: new Array<number>(12).fill(0),
};

export const MAX_CUSTOM_CENTS = 50;

/** Deviation from equal temperament per pitch class (0 = C), shifted so that A (9) is 0. */
export function temperamentOffsets(t: TemperamentSettings): number[] {
  let byPc: number[];
  if (t.temperament === 'custom') {
    byPc = t.customCents.slice(0, 12);
  } else {
    const table = TABLES[t.temperament] ?? TABLES.equal;
    byPc = Array.from({ length: 12 }, (_, pc) => table[(pc - t.temperamentTonic + 12) % 12]);
  }
  const a = byPc[9];
  return byPc.map((c) => c - a);
}

export function isEqualTemperament(t: TemperamentSettings): boolean {
  return temperamentOffsets(t).every((c) => Math.abs(c) < 0.05);
}

export function cleanTemperament(raw: any): TemperamentSettings {
  const id = TEMPERAMENT_IDS.includes(raw?.temperament) ? (raw.temperament as TemperamentId) : 'equal';
  const tonic = Number.isInteger(raw?.temperamentTonic) && raw.temperamentTonic >= 0 && raw.temperamentTonic <= 11 ? raw.temperamentTonic : 0;
  const cc = Array.isArray(raw?.customCents) ? raw.customCents : [];
  const customCents = Array.from({ length: 12 }, (_, i) => {
    const v = Number(cc[i]);
    return Number.isFinite(v) ? Math.max(-MAX_CUSTOM_CENTS, Math.min(MAX_CUSTOM_CENTS, Math.round(v * 10) / 10)) : 0;
  });
  return { temperament: id, temperamentTonic: tonic, customCents };
}
