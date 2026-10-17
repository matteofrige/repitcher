import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, StyleSheet, View } from 'react-native';
import ReorderableList, { useReorderableDrag, type ReorderableListReorderEvent } from 'react-native-reorderable-list';

import { s } from '../../i18n';
import { Button, Hairline, tick } from '../../components/Controls';
import { BottomDock } from '../../components/BottomDock';
import { Paper } from '../../components/Paper';
import { HeaderTextButton, ScreenHeader } from '../../components/ScreenHeader';
import { TrackRow } from '../../components/TrackRow';
import {
  getTrack,
  movePlaylistIndices,
  movePlaylistItem,
  removePlaylistIndices,
  sortPlaylistByName,
  usePlaylist,
  useTracks,
  type Track,
} from '../../lib/library';
import { SymbolView } from 'expo-symbols';
import { showActionSheet } from '../../lib/promptHost';
import { useColors } from '../../theme';
import { playTrack, usePlayingTrackId } from '../../lib/player';
import { formatPlaylistSummary } from '../../lib/tuning';
import { LIST_MAX_WIDTH, column } from '../../theme/layout';
import { fonts, T } from '../../theme/type';
import { sym } from '../../lib/icons';

/** Drag handle: pressing it starts the drag; up/down are exposed as accessibility actions for VoiceOver/TalkBack. */
function DragHandle({
  title,
  onMove,
  canUp,
  canDown,
}: {
  title: string;
  onMove: (delta: -1 | 1) => void;
  canUp: boolean;
  canDown: boolean;
}) {
  const drag = useReorderableDrag();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={s.playlists.dragA11y(title)}
      accessibilityActions={[
        ...(canUp ? [{ name: 'up', label: s.playlists.moveUp(title) }] : []),
        ...(canDown ? [{ name: 'down', label: s.playlists.moveDown(title) }] : []),
      ]}
      onAccessibilityAction={(e) => onMove(e.nativeEvent.actionName === 'up' ? -1 : 1)}
      onPressIn={() => {
        tick();
        drag();
      }}
      hitSlop={4}
      style={styles.handle}>
      <SymbolView name={sym('line.3.horizontal')} size={22} tintColor={colors.inkSecondary} resizeMode="scaleAspectFit" />
    </Pressable>
  );
}

export default function PlaylistDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlist = usePlaylist(id);
  useTracks();
  const playingId = usePlayingTrackId();
  const [editing, setEditing] = useState(false);
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [picked, setPicked] = useState<Set<number>>(new Set());

  // Removing the last row would otherwise leave edit mode on with no "Fine" button to leave it.
  const count = playlist?.trackIds.length ?? 0;
  const [prevCount, setPrevCount] = useState(count);
  if (prevCount !== count) {
    setPrevCount(count);
    if (count === 0) setEditing(false);
    if ([...picked].some((i) => i >= count)) setPicked(new Set([...picked].filter((i) => i < count)));
  }

  const setEdit = (on: boolean) => {
    setEditing(on);
    setPicked(new Set());
  };

  if (!playlist) return <Paper />;

  const tracks = playlist.trackIds.map((tid) => getTrack(tid)).filter((t): t is Track => !!t);
  // Index-free row keys (the reorderable list animates by key): nth occurrence of the same track.
  const seen = new Map<string, number>();
  const rowKeys = tracks.map((t) => {
    const n = seen.get(t.id) ?? 0;
    seen.set(t.id, n + 1);
    return `${t.id}#${n}`;
  });
  const seconds = tracks.every((t) => t.duration > 0) ? tracks.reduce((s, t) => s + t.duration, 0) : 0;
  const ids = tracks.map((t) => t.id);
  const source = s.playlists.fromPlaylist(playlist.name);
  const last = tracks.length - 1;

  const sel = [...picked].sort((a, b) => a - b);
  const allPicked = tracks.length > 0 && picked.size === tracks.length;
  const toggle = (i: number) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(i)) next.add(i);
      return next;
    });
  const onReorder = ({ from, to }: ReorderableListReorderEvent) => {
    // The list is reordered locally during the drag; the store is the source of truth afterwards.
    movePlaylistItem(playlist.id, from, to);
    setPicked(new Set());
  };
  const pickedIds = () => sel.map((i) => playlist.trackIds[i]);
  const bulkMove = async () => {
    const choice = await showActionSheet({
      options: [
        { label: s.playlists.moveToTop },
        { label: s.playlists.moveToBottom },
        { label: s.playlists.moveToOther },
      ],
    });
    if (choice === 0 || choice === 1) {
      movePlaylistIndices(playlist.id, sel, choice === 0 ? 'top' : 'bottom');
      setPicked(new Set());
    } else if (choice === 2) {
      router.push({
        pathname: '/add-to-playlist',
        params: { mode: 'pickPlaylist', trackIds: pickedIds().join(','), moveFrom: playlist.id, indices: sel.join(',') },
      } as never);
      setPicked(new Set());
    }
  };

  return (
    <Paper>
      <ScreenHeader
        onBack={() => router.back()}
        backLabel={s.tabs.playlists}
        right={
          tracks.length > 0 ? (
            <HeaderTextButton
              label={editing ? s.playlists.editDone : s.playlists.edit}
              accessibilityLabel={editing ? s.playlists.editDoneA11y : s.playlists.editA11y}
              bold={editing}
              onPress={() => setEdit(!editing)}
            />
          ) : null
        }
      />
      <ReorderableList
        style={{ flex: 1 }}
        contentContainerStyle={column(LIST_MAX_WIDTH)}
        data={tracks}
        dragEnabled={editing}
        onReorder={onReorder}
        keyExtractor={(_, i) => rowKeys[i]}
        extraData={[playingId, editing, picked]}
        ItemSeparatorComponent={() => <Hairline />}
        ListHeaderComponent={
          <View style={styles.top}>
            <T variant="title" accessibilityRole="header">
              {playlist.name}
            </T>
            <T variant="footnote">{formatPlaylistSummary(tracks.length, seconds)}</T>
            <View style={styles.actions}>
              <Button
                label={s.common.play}
                symbol={sym('play.fill')}
                disabled={tracks.length === 0}
                onPress={() => playTrack(ids, 0, source)}
              />
              <Button
                label={s.playlists.add}
                symbol={sym('plus')}
                kind="secondary"
                onPress={() =>
                  router.push({ pathname: '/add-to-playlist', params: { mode: 'pickTracks', playlistId: playlist.id } } as never)
                }
              />
            </View>
            {editing ? (
              <View style={styles.selectRow}>
                <T variant="callout">{s.library.selectedCount(picked.size)}</T>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={allPicked ? s.common.deselectAll : s.common.selectAll}
                  onPress={() => setPicked(allPicked ? new Set() : new Set(tracks.map((_, i) => i)))}
                  style={styles.headerBtn}>
                  <T variant="callout" tone="tint" maxScale={1.3}>
                    {allPicked ? s.common.deselectAll : s.common.selectAll}
                  </T>
                </Pressable>
              </View>
            ) : null}
            {editing ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.playlists.sortByName}
                onPress={() => {
                  sortPlaylistByName(playlist.id);
                  setPicked(new Set());
                }}
                style={[styles.headerBtn, styles.sortBtn]}>
                <T variant="callout" tone="tint" maxScale={1.3}>
                  {s.playlists.sortByName}
                </T>
              </Pressable>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <T variant="body" tone="inkSecondary" style={styles.empty}>
            {s.playlists.detailEmpty}
          </T>
        }
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            ordinal={index + 1}
            playing={item.id === playingId}
            selected={editing ? picked.has(index) : undefined}
            onPress={editing ? () => toggle(index) : () => playTrack(ids, index, source)}
            trailing={
              editing ? (
                <DragHandle
                  title={item.title}
                  canUp={index > 0}
                  canDown={index < last}
                  onMove={(d) => movePlaylistItem(playlist.id, index, index + d)}
                />
              ) : undefined
            }
            showAnnotation={!editing}
          />
        )}
      />
      {editing ? (
        <View style={[styles.bar, { backgroundColor: colors.plate, borderTopColor: colors.rule }]}>
          <View style={[styles.barRow, column(LIST_MAX_WIDTH)]}>
          <Button
            label={s.playlists.bulkMove}
            kind="secondary"
            style={styles.barBtn}
            disabled={picked.size === 0}
            onPress={() => void bulkMove()}
          />
          <Button
            label={s.playlists.bulkCopy}
            kind="secondary"
            style={styles.barBtn}
            disabled={picked.size === 0}
            onPress={() => {
              router.push({
                pathname: '/add-to-playlist',
                params: { mode: 'pickPlaylist', trackIds: pickedIds().join(',') },
              } as never);
              setPicked(new Set());
            }}
          />
          <Button
            label={s.playlists.bulkRemove}
            kind="danger"
            style={styles.barBtn}
            disabled={picked.size === 0}
            onPress={() => {
              removePlaylistIndices(playlist.id, sel);
              setPicked(new Set());
            }}
          />
          </View>
        </View>
      ) : null}
      <View style={{ paddingBottom: insets.bottom }}>
        <BottomDock />
      </View>
    </Paper>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, gap: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 12 },
  empty: { paddingHorizontal: 32, paddingTop: 32, textAlign: 'center', fontFamily: fonts.caslon },
  headerBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  selectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  barRow: { flexDirection: 'row', gap: 12 },
  bar: { paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
  barBtn: { flex: 1, paddingHorizontal: 8 },
  sortBtn: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  handle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
