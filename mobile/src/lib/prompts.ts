import { s } from '../i18n';
import { createPlaylist, deletePlaylist, deleteTrack, renamePlaylist, renameTrack } from './library';
import type { Playlist, Track } from './library';
import { showActionSheet, showAlert, showPrompt } from './promptHost';

export async function promptNewPlaylist(onCreated?: (id: string) => void) {
  const name = await showPrompt({
    title: s.prompts.newPlaylistTitle,
    message: s.prompts.newPlaylistMessage,
    defaultValue: '',
    confirmLabel: s.common.create,
  });
  if (name === null) return;
  const id = createPlaylist(name);
  if (id) onCreated?.(id);
}

export async function promptRenameTrack(track: Track) {
  const name = await showPrompt({
    title: s.prompts.renameTrackTitle,
    defaultValue: track.title,
    confirmLabel: s.common.save,
  });
  if (name !== null) renameTrack(track.id, name);
}

export async function promptRenamePlaylist(playlist: Playlist) {
  const name = await showPrompt({
    title: s.prompts.renamePlaylistTitle,
    defaultValue: playlist.name,
    confirmLabel: s.common.save,
  });
  if (name !== null) renamePlaylist(playlist.id, name);
}

/** Cancel + destructive Delete; resolves true when Delete is pressed. */
async function confirmDelete(title: string, message: string): Promise<boolean> {
  const i = await showAlert({
    title,
    message,
    buttons: [
      { label: s.common.cancel, style: 'cancel' },
      { label: s.common.delete, style: 'destructive' },
    ],
  });
  return i === 1;
}

export async function confirmDeleteTrack(track: Track) {
  if (await confirmDelete(s.prompts.deleteTrackTitle(track.title), s.prompts.deleteTrackMessage)) deleteTrack(track.id);
}

export async function confirmDeleteTracks(count: number, onConfirm: () => void) {
  if (await confirmDelete(s.prompts.deleteTracksTitle(count), s.prompts.deleteTracksMessage)) onConfirm();
}

export async function confirmDeletePlaylist(playlist: Playlist) {
  if (await confirmDelete(s.prompts.deletePlaylistTitle(playlist.name), s.prompts.deletePlaylistMessage)) {
    deletePlaylist(playlist.id);
  }
}

export async function trackActionSheet(
  track: Track,
  actions: { addToPlaylist: () => void },
) {
  const i = await showActionSheet({
    title: track.title,
    options: [
      { label: s.prompts.addToPlaylist },
      { label: s.common.rename },
      { label: s.common.delete, destructive: true },
    ],
  });
  if (i === 0) actions.addToPlaylist();
  else if (i === 1) void promptRenameTrack(track);
  else if (i === 2) confirmDeleteTrack(track);
}

export async function playlistActionSheet(playlist: Playlist) {
  const i = await showActionSheet({
    title: playlist.name,
    options: [{ label: s.common.rename }, { label: s.common.delete, destructive: true }],
  });
  if (i === 0) void promptRenamePlaylist(playlist);
  else if (i === 1) confirmDeletePlaylist(playlist);
}
