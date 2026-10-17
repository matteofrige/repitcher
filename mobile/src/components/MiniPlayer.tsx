import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { s } from '../i18n';
import { next, toggle, usePlayer } from '../lib/player';
import { useTrack } from '../lib/library';
import { formatTrackNote } from '../lib/trackNote';
import { useColors } from '../theme';
import { LIST_MAX_WIDTH, column } from '../theme/layout';
import { T } from '../theme/type';
import { IconButton } from './Controls';
import { sym } from '../lib/icons';

/** Docked above the tab bar. Hidden when nothing is loaded. */
export function MiniPlayer() {
  const colors = useColors();
  const { queue, index, isPlaying } = usePlayer();
  const track = useTrack(queue[index]);
  if (!track) return null;
  const annotation = formatTrackNote(track, ' · ');
  const hasNext = index + 1 < queue.length;

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.plate, borderTopColor: colors.rule, borderTopWidth: StyleSheet.hairlineWidth },
      ]}>
      <View style={[styles.inner, column(LIST_MAX_WIDTH)]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={s.player.miniA11y(track.title)}
        onPress={() => router.push('/player')}
        style={styles.body}>
        <T variant="subhead" numberOfLines={1} maxScale={1.3}>
          {track.title}
        </T>
        {annotation ? (
          <T variant="annotation" numberOfLines={1} maxScale={1.3}>
            {annotation}
          </T>
        ) : null}
      </Pressable>
      <IconButton
        symbol={isPlaying ? sym('pause.fill') : sym('play.fill')}
        label={isPlaying ? s.common.pause : s.common.play}
        onPress={() => void toggle()}
        size={24}
        hit={48}
      />
      <IconButton
        symbol={sym('forward.end.fill')}
        label={s.common.nextTrack}
        onPress={next}
        disabled={!hasNext}
        size={22}
        hit={48}
      />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { minHeight: 60 },
  inner: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 8 },
  body: { flex: 1, minHeight: 56, justifyContent: 'center', paddingRight: 8 },
});
