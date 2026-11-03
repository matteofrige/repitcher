export type CountInPlan = { times: number[]; inBars: number[] };

/**
 * Count-in clicks before the track starts at `position`, laid on the beat grid of the track.
 *
 * Musical choice: the entry is the first real beat at or after the start position (the music "comes in" there). The count
 * always begins on a "1": a full bar of clicks, plus the beats of the bar before the entry when the entry is mid-bar, so the
 * player hears 1-2-3-4 and lands on the right beat of the bar. Spacing is constant, equal to the local tempo at the entry
 * (median of the next intervals), so the clicks may fall before the file start (negative times) where no real beats exist.
 * Returns null when the grid has no usable tempo there.
 */
export function countInPlan(beats: number[], position: number, beatsPerBar: number, downbeatIndex: number): CountInPlan | null {
  const e = beats.findIndex((b) => b >= position - 0.02);
  if (e < 0) return null;
  const deltas: number[] = [];
  for (let i = e; i < beats.length - 1 && deltas.length < 4; i++) deltas.push(beats[i + 1] - beats[i]);
  if (deltas.length === 0) {
    for (let i = e; i >= 1 && deltas.length < 4; i--) deltas.push(beats[i] - beats[i - 1]);
  }
  if (deltas.length === 0) return null;
  const sorted = [...deltas].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const T = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  if (!Number.isFinite(T) || T < 0.2 || T > 2.0) return null;
  const bpb = Math.max(1, Math.round(beatsPerBar));
  const mod = (x: number) => ((x % bpb) + bpb) % bpb;
  const inBarE = mod(e - downbeatIndex);
  const n = bpb + inBarE;
  const times: number[] = [];
  const inBars: number[] = [];
  for (let k = n; k >= 1; k--) {
    times.push(beats[e] - k * T);
    inBars.push(mod(inBarE - k));
  }
  times.push(beats[e]);
  inBars.push(inBarE);
  return { times, inBars };
}
