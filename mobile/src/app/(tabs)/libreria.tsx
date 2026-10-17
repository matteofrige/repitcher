import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { Button, Hairline, IconButton } from '../../components/Controls';
import { EmptyState } from '../../components/EmptyState';
import { Paper } from '../../components/Paper';
import { TrackRow } from '../../components/TrackRow';
import { s } from '../../i18n';
import { localizedError } from '../../lib/errors';
import { compareTrackNames, deleteTracks, importFiles, normalizeText, useTracks, type Track } from '../../lib/library';
import { playTrack, usePlayingTrackId } from '../../lib/player';
import { showAlert } from '../../lib/promptHost';
import { confirmDeleteTracks, trackActionSheet } from '../../lib/prompts';
import { useColors } from '../../theme';
import { LIST_MAX_WIDTH, column } from '../../theme/layout';
import { fonts, T } from '../../theme/type';
import { sym } from '../../lib/icons';

export default function LibraryScreen() {
  const colors = useColors();
  const tracks = useTracks();
  const playingId = usePlayingTrackId();
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Drop picks of deleted tracks and leave selection mode once the library is empty (render-time, not in an effect).
  const [prevTracks, setPrevTracks] = useState(tracks);
  if (prevTracks !== tracks) {
    setPrevTracks(tracks);
    const live = new Set(tracks.map((t) => t.id));
    if (tracks.length === 0) {
      setSelecting(false);
      setPicked(new Set());
    } else if ([...picked].some((id) => !live.has(id))) {
      setPicked(new Set([...picked].filter((id) => live.has(id))));
    }
  }

  const exitSelection = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const terms = useMemo(() => normalizeText(query).split(/\s+/).filter(Boolean), [query]);
  const visible = useMemo(() => {
    const found = terms.length
      ? tracks.filter((t) => {
          const title = normalizeText(t.title);
          return terms.every((term) => title.includes(term));
        })
      : tracks;
    // Sort a copy: the stored array keeps import order.
    return [...found].sort(compareTrackNames);
  }, [tracks, terms]);

  const doImport = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const { failed, unsupported } = await importFiles();
      if (failed.length && unsupported.length) {
        await showAlert({
          title: s.library.importPartialTitle,
          message: `${s.library.importUnsupportedBody(unsupported)}\n\n${s.library.importPartialBody(failed)}`,
        });
      } else if (unsupported.length) {
        await showAlert({ title: s.library.importUnsupportedTitle, message: s.library.importUnsupportedBody(unsupported) });
      } else if (failed.length) {
        await showAlert({ title: s.library.importPartialTitle, message: s.library.importPartialBody(failed) });
      }
    } catch (e) {
      await showAlert({ title: s.library.importFailedTitle, message: s.library.importFailedBody(localizedError(e)) });
    } finally {
      setImporting(false);
    }
  };

  const openMenu = (t: Track) =>
    trackActionSheet(t, {
      addToPlaylist: () =>
        router.push({ pathname: '/add-to-playlist', params: { mode: 'pickPlaylist', trackId: t.id } } as never),
    });

  const ids = visible.map((t) => t.id);
  const allVisiblePicked = ids.length > 0 && ids.every((id) => picked.has(id));
  const toggleAll = () => setPicked(allVisiblePicked ? new Set() : new Set(ids));
  const searching = terms.length > 0;

  // A JSX element (not a component defined inline): its identity is stable across keystrokes,
  // so the TextInput keeps focus while typing.
  const header = (
    <View>
      <View style={styles.header}>
        <T variant="largeTitle" accessibilityRole="header" style={{ flex: 1 }}>
          {s.library.title}
        </T>
        {selecting ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.common.done}
            onPress={exitSelection}
            style={({ pressed }) => [styles.importBtn, { opacity: pressed ? 0.55 : 1 }]}>
            <T variant="headline" tone="tint" maxScale={1.3}>
              {s.common.done}
            </T>
          </Pressable>
        ) : importing ? (
          <ActivityIndicator color={colors.tint} style={styles.importBtn} />
        ) : (
          <>
            {tracks.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.library.selectA11y}
                onPress={() => setSelecting(true)}
                style={({ pressed }) => [styles.importBtn, { opacity: pressed ? 0.55 : 1 }]}>
                <T variant="callout" tone="tint" maxScale={1.3}>
                  {s.common.select}
                </T>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.library.importA11y}
              onPress={doImport}
              style={({ pressed }) => [styles.importBtn, { opacity: pressed ? 0.55 : 1 }]}>
              <SymbolView name={sym('plus')} size={17} tintColor={colors.tint} />
              <T variant="callout" tone="tint" maxScale={1.3}>
                {s.library.import}
              </T>
            </Pressable>
          </>
        )}
      </View>
      {tracks.length > 0 ? (
        <View style={[styles.search, { backgroundColor: colors.plate }]}>
          <SymbolView name={sym('magnifyingglass')} size={16} tintColor={colors.inkSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={s.library.searchPlaceholder}
            placeholderTextColor={colors.inkSecondary}
            accessibilityLabel={s.library.searchPlaceholder}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="never"
            maxFontSizeMultiplier={1.3}
            style={[styles.searchInput, { color: colors.ink }]}
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.library.searchClear}
              onPress={() => setQuery('')}
              hitSlop={4}
              style={styles.clearBtn}>
              <SymbolView name={sym('xmark.circle.fill')} size={17} tintColor={colors.inkSecondary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {selecting ? (
        <View style={styles.selectRow}>
          <T variant="callout">{s.library.selectedCount(picked.size)}</T>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={allVisiblePicked ? s.common.deselectAll : s.common.selectAll}
            disabled={ids.length === 0}
            onPress={toggleAll}
            style={({ pressed }) => [styles.importBtn, { opacity: ids.length === 0 ? 0.4 : pressed ? 0.55 : 1 }]}>
            <T variant="callout" tone="tint" maxScale={1.3}>
              {allVisiblePicked ? s.common.deselectAll : s.common.selectAll}
            </T>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <Paper>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <FlatList
          data={visible}
          contentContainerStyle={column(LIST_MAX_WIDTH)}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(t) => t.id}
          extraData={[playingId, selecting, picked]}
          ItemSeparatorComponent={() => <Hairline />}
          ListHeaderComponent={header}
          ListFooterComponent={
            visible.length > 0 && !searching ? (
              <T variant="footnote" tone="inkSecondary" style={styles.formatsFooter}>
                {s.library.formatsFooter}
              </T>
            ) : null
          }
          ListEmptyComponent={
            importing ? null : searching ? (
              <T variant="body" tone="inkSecondary" style={styles.noResults}>
                {s.library.searchNoResults(query.trim())}
              </T>
            ) : (
              <EmptyState
                title={s.library.emptyTitle}
                body={s.library.emptyBody}
                actionLabel={s.library.emptyAction}
                onAction={doImport}
              />
            )
          }
          renderItem={({ item, index }) =>
            selecting ? (
              <TrackRow
                track={item}
                playing={item.id === playingId}
                selected={picked.has(item.id)}
                onPress={() => toggle(item.id)}
              />
            ) : (
              <TrackRow
                track={item}
                playing={item.id === playingId}
                onPress={() => playTrack(ids, index, s.library.fromLibrary)}
                onLongPress={() => openMenu(item)}
                trailing={
                  <IconButton
                    symbol={sym('ellipsis')}
                    label={s.library.actionsFor(item.title)}
                    tone="inkSecondary"
                    onPress={() => openMenu(item)}
                  />
                }
              />
            )
          }
        />
        {selecting ? (
          <View style={[styles.bar, { backgroundColor: colors.plate, borderTopColor: colors.rule }]}>
            <View style={[styles.barRow, column(LIST_MAX_WIDTH)]}>
            <Button
              label={s.library.bulkAddToPlaylist}
              kind="secondary"
              symbol={sym('plus')}
              style={{ flex: 1 }}
              disabled={picked.size === 0}
              onPress={() => {
                router.push({
                  pathname: '/add-to-playlist',
                  params: { mode: 'pickPlaylist', trackIds: [...picked].join(',') },
                } as never);
                exitSelection();
              }}
            />
            <Button
              label={s.common.delete}
              kind="danger"
              style={{ flex: 1 }}
              disabled={picked.size === 0}
              onPress={() =>
                confirmDeleteTracks(picked.size, () => {
                  deleteTracks([...picked]);
                  exitSelection();
                })
              }
            />
            </View>
          </View>
        ) : null}
      </SafeAreaView>
    </Paper>
  );
}

const styles = StyleSheet.create({
  formatsFooter: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingLeft: 10,
    borderRadius: 10,
    gap: 6,
  },
  searchInput: { flex: 1, fontFamily: fonts.caslon, fontSize: 17, paddingVertical: 0 },
  clearBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginVertical: -2 },
  selectRow: {
    paddingHorizontal: 20,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barRow: { flexDirection: 'row', gap: 12 },
  bar: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  noResults: { textAlign: 'center', padding: 32 },
  importBtn: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
});
