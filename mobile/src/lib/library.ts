import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import * as RepitchAudio from '../../modules/repitch-audio';
import { lang } from '../i18n';
import { hasSupportedExtension } from './formats';
import { DEFAULT_TEMPERAMENT, cleanTemperament, type TemperamentSettings } from './temperaments';
import {
  MAX_CENTS,
  MAX_REF_HZ,
  MAX_SEMITONES,
  MIN_REF_HZ,
  NEUTRAL_TUNING,
  totalSemitones,
  type TrackTuning,
  type Tuning,
} from './tuning';

export type Track = {
  id: string;
  /** Relative to Paths.document/tracks — never store absolute URIs (container path changes). */
  fileName: string;
  title: string;
  duration: number;
  addedAt: number;
  /** Per-track exception (semitones/cents); null = follows the global tuning. */
  override: TrackTuning | null;
  /** Track's own A, estimated by the native detector. */
  detectedHz: number | null;
  detectedConfidence: number | null;
  /** null = not analysed yet (queued at import/startup). */
  detection: 'pending' | 'done' | 'failed' | null;
  /** Manual choice of the track's A; wins over detectedHz. */
  sourceHz: number | null;
  /** Original file name (with extension) at import; used to match settings backups. */
  originalName?: string;
};

/** Settings of a backed-up track that has no counterpart in the library yet. */
export type BackupTrack = {
  key: { title: string; duration: number; originalName?: string };
  override: TrackTuning | null;
  sourceHz: number | null;
  /** Names of the playlists the track belonged to. */
  playlistNames: string[];
};

export type Playlist = {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
};

export type ToolsSettings = {
  bpm: number;
  beatsPerBar: number;
  /** 0…100 */
  volume: number;
  flash: boolean;
  /** Pitch class 0…11 (C = 0) or 'auto'. */
  tunerTarget: number | 'auto';
} & TemperamentSettings;

export const DEFAULT_TOOLS: ToolsSettings = { bpm: 100, beatsPerBar: 4, volume: 80, flash: false, tunerTarget: 'auto', ...DEFAULT_TEMPERAMENT };

// ---- sanitisers: library file and settings backups are untrusted JSON ----

/** Finite number clamped to [lo, hi], else `fallback`. */
function clampNum(x: unknown, lo: number, hi: number, fallback: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : fallback;
}
function cleanString(x: unknown, maxLength: number): string | null {
  return typeof x === 'string' ? x.slice(0, maxLength) : null;
}
/** Global tuning within the UI ranges (±12 st, ±50 ¢, 392–465 Hz); anything else is neutral. */
export function cleanTuning(raw: any): Tuning {
  return {
    semitones: Math.round(clampNum(raw?.semitones, -MAX_SEMITONES, MAX_SEMITONES, 0)),
    cents: Math.round(clampNum(raw?.cents, -MAX_CENTS, MAX_CENTS, 0)),
    refHz: clampNum(raw?.refHz, MIN_REF_HZ, MAX_REF_HZ, NEUTRAL_TUNING.refHz),
  };
}
/** Metronome/tuner settings within the ranges of the native cores (bpm 20–300, 1–12 beats, 0–100 volume). */
export function cleanTools(raw: any): ToolsSettings {
  const t = raw && typeof raw === 'object' ? raw : {};
  const target = t.tunerTarget;
  return {
    bpm: clampNum(t.bpm, 20, 300, DEFAULT_TOOLS.bpm),
    beatsPerBar: Math.round(clampNum(t.beatsPerBar, 1, 12, DEFAULT_TOOLS.beatsPerBar)),
    volume: clampNum(t.volume, 0, 100, DEFAULT_TOOLS.volume),
    flash: t.flash === true,
    tunerTarget: Number.isInteger(target) && target >= 0 && target <= 11 ? target : 'auto',
    ...cleanTemperament(t),
  };
}
function cleanOverride(o: any): TrackTuning | null {
  if (!o || typeof o.semitones !== 'number' || typeof o.cents !== 'number') return null;
  return {
    semitones: Math.round(clampNum(o.semitones, -MAX_SEMITONES, MAX_SEMITONES, 0)),
    cents: Math.round(clampNum(o.cents, -MAX_CENTS, MAX_CENTS, 0)),
  };
}
/** A track's own A must be a plausible pitch (same range as the manual choice); else "unknown". */
function cleanHz(h: any): number | null {
  return typeof h === 'number' && Number.isFinite(h) && h >= MIN_REF_HZ && h <= MAX_REF_HZ ? h : null;
}
/** Only a plain name is accepted as a file name inside the tracks folder (never a path). */
function isSafeFileName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 255 && !/[/\\]|^\.\.?$/.test(name);
}
/** Extension kept from the picked file: ".mp3"-like only, so the stored name can never be a path. */
function safeExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

type LibraryState = {
  loaded: boolean;
  tools: ToolsSettings;
  installedAsFree: boolean;
  globalTuning: Tuning;
  tracks: Track[];
  playlists: Playlist[];
  pendingRestore: BackupTrack[];
};

const DB_NAME = 'repitch-library.json';
const SAVE_DEBOUNCE_MS = 300;

let state: LibraryState = { loaded: false, installedAsFree: true, tools: DEFAULT_TOOLS, globalTuning: NEUTRAL_TUNING, tracks: [], playlists: [], pendingRestore: [] };
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Called by the player when a track is removed so playback can stop/advance. */
let onTrackRemoved: ((id: string) => void) | null = null;
export function setTrackRemovedHandler(fn: (id: string) => void) {
  onTrackRemoved = fn;
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function emit() {
  listeners.forEach((l) => l());
}

function dbFile() {
  return new File(Paths.document, DB_NAME);
}
function tracksDir() {
  return new Directory(Paths.document, 'tracks');
}

export function trackUri(track: Pick<Track, 'fileName'>): string {
  return new File(tracksDir(), track.fileName).uri;
}

function set(next: Partial<LibraryState>, persist = true) {
  state = { ...state, ...next };
  emit();
  if (persist) scheduleSave();
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
}

export function flush() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    const { installedAsFree, globalTuning, tools, tracks, playlists, pendingRestore } = state;
    dbFile().write(
      JSON.stringify({ version: 3, installedAsFree, globalTuning, tools, tracks, playlists, pendingRestore }),
    );
  } catch (e) {
    console.warn('RePitch: saving library failed', e);
  }
}

/** A stored track must at least have an id and a plain file name; anything else is dropped, not crashed on. */
function isTrackRecord(raw: any): boolean {
  return !!raw && typeof raw === 'object' && typeof raw.id === 'string' && raw.id && isSafeFileName(raw.fileName);
}

/** v1 stored semitones/cents/refHz on each track: non-neutral ones become overrides. */
function migrateTrack(raw: any): Track {
  const { semitones, cents, refHz, override, ...rest } = raw;
  // v1 stored the tuning on the track; v2 had override with refHz. Since v3 the override is
  // semitones/cents only: a non-440 refHz is folded into cents (clamped to ±50).
  const legacy = override !== undefined ? override : { semitones, cents, refHz };
  let ov: TrackTuning | null = null;
  if (legacy && typeof legacy === 'object') {
    const s = Math.round(clampNum(legacy.semitones, -MAX_SEMITONES, MAX_SEMITONES, 0));
    const hz = clampNum(legacy.refHz, MIN_REF_HZ, MAX_REF_HZ, 440);
    const c = Math.max(-50, Math.min(50, Math.round(clampNum(legacy.cents, -100, 100, 0) + 1200 * Math.log2(hz / 440))));
    if (override !== undefined || s !== 0 || c !== 0) ov = { semitones: s, cents: c };
  }
  const detection = rest.detection;
  return {
    ...rest,
    title: cleanString(rest.title, 500) || String(rest.fileName),
    duration: clampNum(rest.duration, 0, 1e7, 0),
    addedAt: clampNum(rest.addedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    override: ov,
    detectedHz: cleanHz(rest.detectedHz),
    detectedConfidence: typeof rest.detectedConfidence === 'number' ? clampNum(rest.detectedConfidence, 0, 1, 0) : null,
    detection: detection === 'done' || detection === 'failed' ? detection : null,
    sourceHz: cleanHz(rest.sourceHz),
    ...(typeof rest.originalName === 'string' ? { originalName: rest.originalName.slice(0, 1000) } : { originalName: undefined }),
  };
}

function cleanPlaylists(raw: any, knownIds: Set<string>): Playlist[] {
  if (!Array.isArray(raw)) return [];
  const out: Playlist[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id) continue;
    const name = cleanString(p.name, 500)?.trim();
    if (!name) continue;
    const trackIds: string[] = Array.isArray(p.trackIds)
      ? p.trackIds.filter((t: unknown): t is string => typeof t === 'string' && knownIds.has(t))
      : [];
    out.push({ id: p.id, name, trackIds, createdAt: clampNum(p.createdAt, 0, Number.MAX_SAFE_INTEGER, 0) });
  }
  return out;
}

export async function loadLibrary(): Promise<void> {
  const f = dbFile();
  try {
    if (f.exists) {
      const data = JSON.parse(await f.text());
      if (!data || typeof data !== 'object') throw new Error('library is not an object');
      const tracks: Track[] = Array.isArray(data.tracks) ? data.tracks.filter(isTrackRecord).map(migrateTrack) : [];
      const ids = new Set(tracks.map((t) => t.id));
      set(
        {
          loaded: true,
          installedAsFree: data.installedAsFree !== false,
          globalTuning: cleanTuning(data.globalTuning),
          tools: cleanTools(data.tools),
          tracks,
          playlists: cleanPlaylists(data.playlists, ids),
          pendingRestore: Array.isArray(data.pendingRestore)
            ? data.pendingRestore.filter(isBackupTrack).map(cleanPendingTrack)
            : [],
        },
        false,
      );
      void pumpDetection();
      return;
    }
  } catch (e) {
    console.warn('RePitch: reading library failed', e);
    // Never silently overwrite the user's data with defaults: keep the unreadable file aside first.
    try {
      f.copySync(new File(Paths.document, `${DB_NAME}.corrupt-${Date.now()}`));
    } catch (copyError) {
      console.warn('RePitch: could not preserve the unreadable library', copyError);
    }
  }
  // First launch (or unreadable file): mark install as free-tier once.
  set({ loaded: true, installedAsFree: true });
}

// ---- hooks ----

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function useLibrarySelector<T>(sel: (s: LibraryState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state), () => sel(state));
}
export const useTracks = () => useLibrarySelector((s) => s.tracks);
export const usePlaylists = () => useLibrarySelector((s) => s.playlists);
export const useLibraryLoaded = () => useLibrarySelector((s) => s.loaded);
export const usePendingRestore = () => useLibrarySelector((s) => s.pendingRestore);
export const useTools = () => useLibrarySelector((s) => s.tools);
export function getTools(): ToolsSettings {
  return state.tools;
}
export function setTools(patch: Partial<ToolsSettings>) {
  set({ tools: { ...state.tools, ...patch } });
}
export const useGlobalTuning = () => useLibrarySelector((s) => s.globalTuning);
export const useTrack = (id: string | undefined) =>
  useLibrarySelector((s) => s.tracks.find((t) => t.id === id));
export const usePlaylist = (id: string | undefined) =>
  useLibrarySelector((s) => s.playlists.find((p) => p.id === id));

export function getGlobalTuning(): Tuning {
  return state.globalTuning;
}
/** Transposition for a track: its override, or the global one; `refHz` is always the user's A. */
export function effectiveTuning(track: Track): Tuning {
  const t = track.override ?? state.globalTuning;
  return { semitones: t.semitones, cents: t.cents, refHz: state.globalTuning.refHz };
}
/** The track's own A: manual choice, else detected, else 440. */
/** Below this the detection is shown as "incerto" but not applied automatically (user can pick it). */
export const DETECTION_MIN_CONFIDENCE = 0.5;

export function sourceHzOf(track: Track): number {
  if (track.sourceHz != null) return track.sourceHz;
  const confident = (track.detectedConfidence ?? 0) >= DETECTION_MIN_CONFIDENCE;
  return confident && track.detectedHz != null ? track.detectedHz : 440;
}
/** Total pitch shift in semitones to send to the engine. */
export function trackPitch(track: Track): number {
  return totalSemitones(effectiveTuning(track), sourceHzOf(track));
}

let onTrackChanged: ((id: string) => void) | null = null;
export function setTrackChangedHandler(fn: (id: string) => void) {
  onTrackChanged = fn;
}

let onGlobalTuningChanged: (() => void) | null = null;
export function setGlobalTuningHandler(fn: () => void) {
  onGlobalTuningChanged = fn;
}

export function getTrack(id: string): Track | undefined {
  return state.tracks.find((t) => t.id === id);
}
export function getTracks(): Track[] {
  return state.tracks;
}
export function getPlaylists(): Playlist[] {
  return state.playlists;
}
export function getPlaylist(id: string): Playlist | undefined {
  return state.playlists.find((p) => p.id === id);
}

// ---- track actions ----

export type ImportResult = { imported: number; failed: string[]; unsupported: string[] };

export async function importFiles(): Promise<ImportResult> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: 'audio/*',
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (picked.canceled) return { imported: 0, failed: [], unsupported: [] };

  const dir = tracksDir();
  if (!dir.exists) dir.create({ intermediates: true });

  const added: Track[] = [];
  const failed: string[] = [];
  const unsupported: string[] = [];
  const canProbe = RepitchAudio.hasProbeAudio();
  for (const asset of picked.assets) {
    // Without the native probe the extension is the only signal; with it, the decoder decides.
    if (!canProbe && !hasSupportedExtension(asset.name)) {
      unsupported.push(asset.name);
      continue;
    }
    try {
      const dot = asset.name.lastIndexOf('.');
      const ext = safeExtension(asset.name);
      const title = (dot > 0 ? asset.name.slice(0, dot) : asset.name).slice(0, 500) || asset.name.slice(0, 500);
      const id = newId();
      const fileName = `${id}${ext}`;
      // copy() is async: without the await a failed copy would still add the track (and reject unhandled).
      const dest = new File(dir, fileName);
      await new File(asset.uri).copy(dest);
      let duration = 0;
      if (canProbe) {
        try {
          const probed = await RepitchAudio.probeAudio(dest.uri);
          if (Number.isFinite(probed.duration) && probed.duration > 0) duration = probed.duration;
        } catch {
          // Not decodable by the player: don't keep it in the library.
          try {
            dest.delete();
          } catch {}
          unsupported.push(asset.name);
          continue;
        }
      }
      added.push({
        id,
        fileName,
        title,
        duration,
        addedAt: Date.now(),
        override: null,
        detectedHz: null,
        detectedConfidence: null,
        detection: null,
        sourceHz: null,
        originalName: asset.name.slice(0, 1000),
      });
    } catch {
      failed.push(asset.name);
    }
  }
  if (added.length) {
    const applied = applyPending(added);
    set({ tracks: [...state.tracks, ...applied.tracks], pendingRestore: applied.pending, playlists: applied.playlists });
    void pumpDetection();
  }
  return { imported: added.length, failed, unsupported };
}

function updateTrack(id: string, patch: Partial<Track>) {
  set({ tracks: state.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
}

export function renameTrack(id: string, title: string) {
  const clean = title.trim();
  if (clean) updateTrack(id, { title: clean });
}

export function setTrackDuration(id: string, duration: number) {
  const t = getTrack(id);
  if (t && Math.abs(t.duration - duration) > 0.5) updateTrack(id, { duration });
}

export function setGlobalTuning(patch: Partial<Tuning>) {
  set({ globalTuning: { ...state.globalTuning, ...patch } });
  onGlobalTuningChanged?.();
}

export function setTrackSourceHz(id: string, hz: number | null) {
  updateTrack(id, { sourceHz: hz });
  onTrackChanged?.(id);
}

export function setTrackOverride(id: string, tuning: TrackTuning | null) {
  updateTrack(id, { override: tuning });
}

export function deleteTrack(id: string) {
  const track = getTrack(id);
  if (!track) return;
  onTrackRemoved?.(id);
  try {
    // Only plain names inside the tracks folder are ever deleted (the name is validated at load/import too).
    const f = isSafeFileName(track.fileName) ? new File(tracksDir(), track.fileName) : null;
    if (f?.exists) f.delete();
  } catch (e) {
    console.warn('RePitch: deleting file failed', e);
  }
  set({
    tracks: state.tracks.filter((t) => t.id !== id),
    playlists: state.playlists.map((p) => ({
      ...p,
      trackIds: p.trackIds.filter((tid) => tid !== id),
    })),
  });
}

export function deleteTracks(ids: string[]) {
  const doomed = new Set(ids.filter((id) => getTrack(id)));
  if (!doomed.size) return;
  for (const id of doomed) {
    const track = getTrack(id);
    if (!track) continue;
    onTrackRemoved?.(id);
    try {
      // Only plain names inside the tracks folder are ever deleted (the name is validated at load/import too).
      const f = isSafeFileName(track.fileName) ? new File(tracksDir(), track.fileName) : null;
      if (f?.exists) f.delete();
    } catch (e) {
      console.warn('RePitch: deleting file failed', e);
    }
  }
  set({
    tracks: state.tracks.filter((t) => !doomed.has(t.id)),
    playlists: state.playlists.map((p) => ({
      ...p,
      trackIds: p.trackIds.filter((tid) => !doomed.has(tid)),
    })),
  });
}

// ---- playlist actions ----

export function createPlaylist(name: string, trackIds: string[] = []): string | undefined {
  const clean = name.trim();
  if (!clean) return undefined;
  const id = newId();
  set({ playlists: [...state.playlists, { id, name: clean, trackIds, createdAt: Date.now() }] });
  return id;
}

function updatePlaylist(id: string, fn: (p: Playlist) => Playlist) {
  set({ playlists: state.playlists.map((p) => (p.id === id ? fn(p) : p)) });
}

export function renamePlaylist(id: string, name: string) {
  const clean = name.trim();
  if (clean) updatePlaylist(id, (p) => ({ ...p, name: clean }));
}

export function deletePlaylist(id: string) {
  set({ playlists: state.playlists.filter((p) => p.id !== id) });
}

/** Appends tracks, skipping ones already in the playlist. */
export function addTracksToPlaylist(id: string, trackIds: string[]) {
  updatePlaylist(id, (p) => ({
    ...p,
    trackIds: [...p.trackIds, ...trackIds.filter((t) => !p.trackIds.includes(t))],
  }));
}

export function removeFromPlaylist(id: string, index: number) {
  updatePlaylist(id, (p) => ({ ...p, trackIds: p.trackIds.filter((_, i) => i !== index) }));
}

/** Removes the entries at these positions (positions, not ids: a playlist may hold duplicates). */
export function removePlaylistIndices(id: string, indices: number[]) {
  const drop = new Set(indices);
  updatePlaylist(id, (p) => ({ ...p, trackIds: p.trackIds.filter((_, i) => !drop.has(i)) }));
}

/** Moves the entries at these positions to the start or end, keeping their relative order. */
export function movePlaylistIndices(id: string, indices: number[], edge: 'top' | 'bottom') {
  const sel = new Set(indices);
  updatePlaylist(id, (p) => {
    const picked = p.trackIds.filter((_, i) => sel.has(i));
    const rest = p.trackIds.filter((_, i) => !sel.has(i));
    return { ...p, trackIds: edge === 'top' ? [...picked, ...rest] : [...rest, ...picked] };
  });
}

/** Appends the entries at these positions of `fromId` to `toId` (skipping ones already there), then removes them from `fromId`. */
export function moveTracksToPlaylist(fromId: string, indices: number[], toId: string) {
  const from = state.playlists.find((p) => p.id === fromId);
  if (!from || fromId === toId) return;
  const sel = new Set(indices);
  const moving = from.trackIds.filter((_, i) => sel.has(i));
  set({
    playlists: state.playlists.map((p) => {
      if (p.id === fromId) return { ...p, trackIds: p.trackIds.filter((_, i) => !sel.has(i)) };
      if (p.id === toId) return { ...p, trackIds: [...p.trackIds, ...moving.filter((t, i) => !p.trackIds.includes(t) && moving.indexOf(t) === i)] };
      return p;
    }),
  });
}

// Natural order: "2 - x" before "10 - x"; accents and case ignored.
const nameCollator = new Intl.Collator(lang, { numeric: true, sensitivity: 'base' });

export function compareTrackNames(a: Track, b: Track): number {
  return (
    nameCollator.compare(a.title, b.title) ||
    a.addedAt - b.addedAt ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Sorts the whole playlist by track name (unknown ids sink to the end, order kept). */
export function sortPlaylistByName(id: string) {
  updatePlaylist(id, (p) => {
    const known = p.trackIds.map((tid) => ({ tid, t: getTrack(tid) }));
    const found = known.filter((k) => k.t).sort((a, b) => compareTrackNames(a.t!, b.t!));
    const lost = known.filter((k) => !k.t);
    return { ...p, trackIds: [...found, ...lost].map((k) => k.tid) };
  });
}

export function movePlaylistItem(id: string, from: number, to: number) {
  updatePlaylist(id, (p) => {
    if (to < 0 || to >= p.trackIds.length || from === to) return p;
    const next = [...p.trackIds];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return { ...p, trackIds: next };
  });
}

// ---- automatic detection of the track's own A (one at a time, in the background) ----

let pumping = false;

export async function pumpDetection(): Promise<void> {
  if (pumping || !RepitchAudio.hasDetectTuning()) return;
  pumping = true;
  try {
    for (;;) {
      const track = state.tracks.find((t) => t.detection === null);
      if (!track) break;
      updateTrack(track.id, { detection: 'pending' });
      let patch: Partial<Track>;
      try {
        const r = await RepitchAudio.detectTuning(trackUri(track));
        patch =
          r && r.valid
            ? { detection: 'done', detectedHz: r.refHz, detectedConfidence: r.confidence }
            : { detection: 'failed' };
      } catch (e) {
        console.warn('RePitch: A detection failed', e);
        patch = { detection: 'failed' };
      }
      // The track may have been deleted meanwhile.
      if (!getTrack(track.id)) continue;
      updateTrack(track.id, patch);
      onTrackChanged?.(track.id);
    }
  } finally {
    pumping = false;
  }
}

// ---- settings backup / restore ----

export function normalizeText(x: string): string {
  return x.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function isBackupTrack(x: any): x is BackupTrack {
  return !!x && typeof x === 'object' && typeof x.key?.title === 'string' && Array.isArray(x.playlistNames);
}

/** Pending entries re-read from the library file go through the same ranges as a fresh backup. */
function cleanPendingTrack(x: BackupTrack): BackupTrack {
  const originalName = cleanString(x.key.originalName, 1000);
  return {
    key: {
      title: x.key.title.slice(0, 500),
      duration: clampNum(x.key.duration, 0, 1e7, 0),
      ...(originalName ? { originalName } : {}),
    },
    override: cleanOverride(x.override),
    sourceHz: cleanHz(x.sourceHz),
    playlistNames: x.playlistNames.filter((n): n is string => typeof n === 'string').slice(0, MAX_BACKUP_PLAYLISTS),
  };
}

/** Upper bounds for a backup file: beyond these it is not a RePitch backup, whatever it claims. */
const MAX_BACKUP_TRACKS = 20000;
const MAX_BACKUP_PLAYLISTS = 2000;

type MatchKey = { title: string; duration: number; originalName?: string };

/** originalName equal when both present, else same normalised title and (similar duration or either unknown). */
export function trackMatches(track: MatchKey, key: MatchKey): boolean {
  if (track.originalName && key.originalName) return track.originalName === key.originalName;
  if (normalizeText(track.title) !== normalizeText(key.title)) return false;
  return track.duration === 0 || key.duration === 0 || Math.abs(track.duration - key.duration) <= 1;
}

/** Newly imported tracks pick up the settings (and playlists) of matching pending entries. */
function applyPending(added: Track[]): { tracks: Track[]; pending: BackupTrack[]; playlists: Playlist[] } {
  let pending = state.pendingRestore;
  let playlists = state.playlists;
  if (!pending.length) return { tracks: added, pending, playlists };
  const tracks = added.map((t) => {
    // Duration is unknown at import time: match on file name or title only.
    const i = pending.findIndex((p) => trackMatches({ ...t, duration: 0 }, { ...p.key, duration: 0 }));
    if (i < 0) return t;
    const p = pending[i];
    pending = pending.filter((_, k) => k !== i);
    for (const name of p.playlistNames) {
      playlists = playlists.map((pl) =>
        pl.name === name && !pl.trackIds.includes(t.id) ? { ...pl, trackIds: [...pl.trackIds, t.id] } : pl,
      );
    }
    return { ...t, override: p.override, sourceHz: p.sourceHz };
  });
  return { tracks, pending, playlists };
}

export type RestoreReport = { matched: number; pending: number; playlists: number };

export class BackupError extends Error {
  code = 'E_BACKUP_INVALID';
  constructor() {
    super('E_BACKUP_INVALID');
  }
}

export function restoreBackup(data: any): RestoreReport {
  if (!data || typeof data !== 'object') throw new BackupError();
  if (data.app !== 'RePitch' || data.kind !== 'settings-backup' || data.version !== 1) throw new BackupError();
  if (!Array.isArray(data.tracks) || !Array.isArray(data.playlists)) throw new BackupError();
  if (data.tracks.length > MAX_BACKUP_TRACKS || data.playlists.length > MAX_BACKUP_PLAYLISTS) throw new BackupError();

  // Every field is range-checked: the file is user-supplied and its values reach the native pitch shifter.
  const globalTuning = cleanTuning(data.globalTuning);
  const tools = cleanTools(data.tools);

  const bTracks: BackupTrack[] = data.tracks.map((x: any) => {
    const originalName = cleanString(x?.key?.originalName, 1000);
    return {
      key: {
        title: cleanString(x?.key?.title, 500) ?? '',
        duration: clampNum(x?.key?.duration, 0, 1e7, 0),
        ...(originalName ? { originalName } : {}),
      },
      override: cleanOverride(x?.override),
      sourceHz: cleanHz(x?.sourceHz),
      playlistNames: [],
    };
  });

  // bTracks index -> library track id (first unused match wins).
  const used = new Set<string>();
  const matchedId: (string | null)[] = bTracks.map((b) => {
    const found = state.tracks.find((t) => !used.has(t.id) && trackMatches(t, b.key));
    if (!found) return null;
    used.add(found.id);
    return found.id;
  });

  const tracks = state.tracks.map((t) => {
    const i = matchedId.indexOf(t.id);
    if (i < 0) return t;
    return { ...t, override: bTracks[i].override, sourceHz: bTracks[i].sourceHz };
  });

  let playlists = state.playlists;
  let restoredPlaylists = 0;
  for (const bp of data.playlists) {
    const name = cleanString(bp?.name, 500)?.trim() ?? '';
    if (!name) continue;
    restoredPlaylists++;
    // Indices must point inside `tracks`; duplicates collapse to the first occurrence.
    const idxs: number[] = Array.isArray(bp.tracks)
      ? [...new Set<number>(bp.tracks.filter((n: any) => Number.isInteger(n) && n >= 0 && n < bTracks.length))]
      : [];
    const ids = idxs.map((n) => matchedId[n]).filter((x): x is string => !!x);
    for (const n of idxs) if (!matchedId[n] && !bTracks[n].playlistNames.includes(name)) bTracks[n].playlistNames.push(name);
    const existing = playlists.find((p) => p.name === name);
    if (existing) {
      playlists = playlists.map((p) => (p === existing ? { ...p, trackIds: ids } : p));
    } else {
      playlists = [...playlists, { id: newId(), name, trackIds: ids, createdAt: Date.now() }];
    }
  }

  const pendingRestore = bTracks.filter((_, i) => !matchedId[i]);
  set({ globalTuning, tools, tracks, playlists, pendingRestore });
  onGlobalTuningChanged?.();
  for (const t of tracks) if (used.has(t.id)) onTrackChanged?.(t.id);
  return { matched: used.size, pending: pendingRestore.length, playlists: restoredPlaylists };
}

export function clearPendingRestore() {
  set({ pendingRestore: [] });
}
