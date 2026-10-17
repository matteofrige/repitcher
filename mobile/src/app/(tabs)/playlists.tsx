import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Hairline, IconButton } from '../../components/Controls';
import { EmptyState } from '../../components/EmptyState';
import { Paper } from '../../components/Paper';
import { s } from '../../i18n';
import { getTrack, usePlaylists, useTracks, type Playlist } from '../../lib/library';
import { playlistActionSheet, promptNewPlaylist } from '../../lib/prompts';
import { formatPlaylistSummary } from '../../lib/tuning';
import { useColors } from '../../theme';
import { LIST_MAX_WIDTH, column } from '../../theme/layout';
import { T } from '../../theme/type';
import { sym } from '../../lib/icons';

export default function PlaylistsScreen() {
  const colors = useColors();
  const playlists = usePlaylists();
  useTracks(); // re-render when durations change

  const open = (p: Playlist) => router.push({ pathname: '/playlist/[id]', params: { id: p.id } } as never);
  const create = () => void promptNewPlaylist((id) => router.push({ pathname: '/playlist/[id]', params: { id } } as never));

  return (
    <Paper>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <FlatList
          data={playlists}
          contentContainerStyle={column(LIST_MAX_WIDTH)}
          keyExtractor={(p) => p.id}
          ItemSeparatorComponent={() => <Hairline />}
          ListHeaderComponent={
            <View style={styles.header}>
              <T variant="largeTitle" accessibilityRole="header" style={{ flex: 1 }}>
                {s.playlists.title}
              </T>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.playlists.newA11y}
                onPress={create}
                style={({ pressed }) => [styles.newBtn, { opacity: pressed ? 0.55 : 1 }]}>
                <SymbolView name={sym('plus')} size={17} tintColor={colors.tint} />
                <T variant="callout" tone="tint" maxScale={1.3}>
                  {s.playlists.new}
                </T>
              </Pressable>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              title={s.playlists.emptyTitle}
              body={s.playlists.emptyBody}
              actionLabel={s.playlists.emptyAction}
              onAction={create}
            />
          }
          renderItem={({ item }) => {
            const durations = item.trackIds.map((id) => getTrack(id)?.duration ?? 0);
            const seconds = durations.every((d) => d > 0) ? durations.reduce((a, d) => a + d, 0) : 0;
            const summary = formatPlaylistSummary(item.trackIds.length, seconds);
            return (
              <View style={styles.row}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${summary}`}
                  onPress={() => open(item)}
                  onLongPress={() => void playlistActionSheet(item)}
                  style={({ pressed }) => [styles.main, pressed && { backgroundColor: colors.plate }]}>
                  <T variant="body" numberOfLines={2}>
                    {item.name}
                  </T>
                  <T variant="footnote">{summary}</T>
                </Pressable>
                <IconButton
                  symbol={sym('ellipsis')}
                  label={s.playlists.actionsFor(item.name)}
                  tone="inkSecondary"
                  onPress={() => void playlistActionSheet(item)}
                />
              </View>
            );
          }}
        />
      </SafeAreaView>
    </Paper>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  newBtn: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 64 },
  main: { flex: 1, minHeight: 64, paddingLeft: 20, paddingVertical: 10, justifyContent: 'center', gap: 2 },
});
