import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet } from 'react-native';

import { s } from '../i18n';
import { Hairline } from '../components/Controls';
import { Paper } from '../components/Paper';
import { PromptHost } from '../components/PromptHost';
import { HeaderTextButton, ScreenHeader } from '../components/ScreenHeader';
import { SheetStatusBar } from '../components/SheetStatusBar';
import { TrackRow } from '../components/TrackRow';
import {
  addTracksToPlaylist,
  compareTrackNames,
  getTrack,
  moveTracksToPlaylist,
  usePlaylist,
  usePlaylists,
  useTracks,
} from '../lib/library';
import { promptNewPlaylist } from '../lib/prompts';
import { formatPlaylistSummary } from '../lib/tuning';
import { useColors } from '../theme';
import { LIST_MAX_WIDTH, column } from '../theme/layout';
import { T } from '../theme/type';

export default function AddToPlaylist() {
  const { mode, playlistId, trackId, trackIds, moveFrom, indices } = useLocalSearchParams<{
    mode?: string;
    playlistId?: string;
    trackId?: string;
    trackIds?: string;
    moveFrom?: string;
    indices?: string;
  }>();
  const ids = trackIds ? trackIds.split(',').filter(Boolean) : trackId ? [trackId] : [];
  const positions = (indices ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0);
  return mode === 'pickPlaylist' && ids.length > 0 ? (
    <PickPlaylist ids={ids} moveFrom={moveFrom} indices={positions} />
  ) : (
    <PickTracks playlistId={playlistId ?? ''} />
  );
}

function PickTracks({ playlistId }: { playlistId: string }) {
  const tracks = useTracks();
  const playlist = usePlaylist(playlistId);
  const [picked, setPicked] = useState<string[]>([]);
  const trackIdsIn = playlist?.trackIds;
  const available = useMemo(() => {
    const existing = new Set(trackIdsIn ?? []);
    return tracks.filter((t) => !existing.has(t.id)).sort(compareTrackNames);
  }, [tracks, trackIdsIn]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Paper>
      <SheetStatusBar />
      <ScreenHeader
        inModal
        title={s.playlists.addTracksTitle}
        left={<HeaderTextButton label={s.common.cancel} onPress={() => router.back()} />}
        right={
          <HeaderTextButton
            label={s.playlists.addCount(picked.length)}
            bold
            disabled={picked.length === 0}
            onPress={() => {
              // Append in the displayed order, not in tap order.
              const chosen = new Set(picked);
              addTracksToPlaylist(playlistId, available.filter((t) => chosen.has(t.id)).map((t) => t.id));
              router.back();
            }}
          />
        }
      />
      <FlatList
        contentContainerStyle={column(LIST_MAX_WIDTH)}
        data={available}
        keyExtractor={(t) => t.id}
        extraData={picked}
        ItemSeparatorComponent={() => <Hairline />}
        ListEmptyComponent={
          <T variant="body" tone="inkSecondary" style={styles.empty}>
            {tracks.length === 0
              ? s.playlists.libraryEmpty
              : s.playlists.allAdded}
          </T>
        }
        renderItem={({ item }) => (
          <TrackRow
            track={item}
            selected={picked.includes(item.id)}
            onPress={() => toggle(item.id)}
          />
        )}
      />
      <PromptHost />
    </Paper>
  );
}

function PickPlaylist({ ids, moveFrom, indices }: { ids: string[]; moveFrom?: string; indices: number[] }) {
  const colors = useColors();
  const allPlaylists = usePlaylists();
  const playlists = moveFrom ? allPlaylists.filter((p) => p.id !== moveFrom) : allPlaylists;
  const track = ids.length === 1 ? getTrack(ids[0]) : undefined;
  const subtitle = ids.length === 1 ? track?.title : s.playlists.tracksCount(ids.length);
  useTracks();

  const addTo = (id: string) => {
    if (moveFrom) moveTracksToPlaylist(moveFrom, indices, id);
    else addTracksToPlaylist(id, ids);
    router.back();
  };

  return (
    <Paper>
      <SheetStatusBar />
      <ScreenHeader
        inModal
        title={moveFrom ? s.playlists.moveToPlaylistTitle : s.playlists.addToPlaylistTitle}
        left={<HeaderTextButton label={s.common.cancel} onPress={() => router.back()} />}
      />
      <FlatList
        contentContainerStyle={column(LIST_MAX_WIDTH)}
        data={playlists}
        keyExtractor={(p) => p.id}
        ItemSeparatorComponent={() => <Hairline />}
        ListHeaderComponent={
          <>
            {subtitle ? (
              <T variant="footnote" numberOfLines={1} style={styles.sub}>
                {subtitle}
              </T>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.playlists.newA11y}
              onPress={() => promptNewPlaylist(addTo)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.plate }]}>
              <T variant="body" tone="tint">
                {s.playlists.newEllipsis}
              </T>
            </Pressable>
            <Hairline />
          </>
        }
        renderItem={({ item }) => {
          // Moving into a playlist that already has them still makes sense: they leave the source.
          const already = !moveFrom && ids.every((tid) => item.trackIds.includes(tid));
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={already ? s.playlists.alreadyA11y(item.name) : item.name}
              disabled={already}
              onPress={() => addTo(item.id)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.plate }, already && { opacity: 0.5 }]}>
              <T variant="body" numberOfLines={2}>
                {item.name}
              </T>
              <T variant="footnote">
                {already ? s.playlists.already : formatPlaylistSummary(item.trackIds.length, 0)}
              </T>
            </Pressable>
          );
        }}
      />
      <PromptHost />
    </Paper>
  );
}

const styles = StyleSheet.create({
  empty: { paddingHorizontal: 32, paddingTop: 32, textAlign: 'center' },
  sub: { paddingHorizontal: 20, paddingVertical: 10 },
  row: { minHeight: 56, paddingHorizontal: 20, paddingVertical: 10, justifyContent: 'center', gap: 2 },
});
