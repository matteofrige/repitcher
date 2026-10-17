import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { s } from '../i18n';
import {
  getGlobalTuning,
  getPlaylists,
  getTools,
  getTracks,
  restoreBackup,
  type RestoreReport,
} from './library';

/** 16 MB: far above any real backup (a few KB per thousand tracks), far below what would hurt. */
const MAX_BACKUP_BYTES = 16 * 1024 * 1024;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function backupFileName(d = new Date()): string {
  return `RePitch-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.repitch.json`;
}

/** Plain object with the settings of every track (not the audio) and the playlists as indices. */
export function buildBackup() {
  const tracks = getTracks();
  const index = new Map(tracks.map((t, i) => [t.id, i]));
  return {
    app: 'RePitch',
    kind: 'settings-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    globalTuning: getGlobalTuning(),
    tools: getTools(),
    tracks: tracks.map((t) => ({
      key: {
        title: t.title,
        duration: t.duration,
        ...(t.originalName ? { originalName: t.originalName } : {}),
      },
      override: t.override,
      sourceHz: t.sourceHz,
    })),
    playlists: getPlaylists().map((p) => ({
      name: p.name,
      tracks: p.trackIds.map((id) => index.get(id)).filter((i): i is number => i !== undefined),
    })),
  };
}

/** Writes the backup to the cache and opens the share sheet. Returns false if sharing is unavailable. */
export async function exportBackup(): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const file = new File(Paths.cache, backupFileName());
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(buildBackup(), null, 2));
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: s.backup.shareTitle,
  });
  return true;
}

/** Picks a backup file; null if cancelled. Throws an Error with a localized message otherwise. */
export async function pickBackup(): Promise<unknown | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'public.json', '*/*'],
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets[0]) return null;
  let text: string;
  try {
    const file = new File(picked.assets[0].uri);
    // A real backup is a few KB; refuse to read (and parse) anything that could exhaust memory.
    if ((file.size ?? picked.assets[0].size ?? 0) > MAX_BACKUP_BYTES) throw new Error(s.backup.errorInvalid);
    text = await file.text();
  } catch (e) {
    throw new Error(e instanceof Error && e.message === s.backup.errorInvalid ? s.backup.errorInvalid : s.backup.errorRead);
  }
  if (text.length > MAX_BACKUP_BYTES) throw new Error(s.backup.errorInvalid);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(s.backup.errorInvalid);
  }
  if (!data || typeof data !== 'object') throw new Error(s.backup.errorInvalid);
  return data;
}

/** Applies a parsed backup. Throws an Error with a localized message if it is not a RePitch backup. */
export function applyBackup(data: unknown): RestoreReport {
  try {
    return restoreBackup(data);
  } catch (e) {
    if ((e as { code?: string })?.code === 'E_BACKUP_INVALID') throw new Error(s.backup.errorInvalid);
    throw new Error(s.backup.errorRead);
  }
}

/** Convenience: pick then apply (no confirmation). null if cancelled. */
export async function pickAndRestoreBackup(): Promise<RestoreReport | null> {
  const data = await pickBackup();
  return data === null ? null : applyBackup(data);
}
