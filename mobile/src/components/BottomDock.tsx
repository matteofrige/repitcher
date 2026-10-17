import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { s } from '../i18n';
import { useTools, useTrack } from '../lib/library';
import { stopMetronome, useMetronome } from '../lib/metronome';
import { usePlayer } from '../lib/player';
import { useColors } from '../theme';
import { LIST_MAX_WIDTH, column } from '../theme/layout';
import { T } from '../theme/type';
import { MiniPlayer } from './MiniPlayer';
import { sym } from '../lib/icons';

/** Hint row + mini player, docked at the bottom. Both hidden when nothing is loaded. */
export function BottomDock() {
  const colors = useColors();
  const { queue, index } = usePlayer();
  const track = useTrack(queue[index]);
  const { running } = useMetronome();
  const { bpm } = useTools();
  return (
    <View>
      {running ? (
        <View
          style={[
            styles.hint,
            { backgroundColor: colors.plate, borderTopColor: colors.rule, borderTopWidth: StyleSheet.hairlineWidth },
          ]}>
          <View style={[styles.hintRow, column(LIST_MAX_WIDTH)]}>
          <SymbolView name={sym('metronome')} size={14} tintColor={colors.tint} />
          <T variant="footnote" maxScale={1.3} style={{ flex: 1 }}>
            {s.metronome.dockLabel(bpm)}
          </T>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.metronome.stopA11y}
            onPress={() => void stopMetronome()}
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}>
            <T variant="callout" tone="tint" maxScale={1.3}>
              {s.common.stop}
            </T>
          </Pressable>
          </View>
        </View>
      ) : null}
      {track ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.player.dockHintA11y}
          onPress={() => router.push('/player')}
          style={[
            styles.hint,
            { backgroundColor: colors.plate, borderTopColor: colors.rule, borderTopWidth: StyleSheet.hairlineWidth },
          ]}>
          <View style={[styles.hintRow, column(LIST_MAX_WIDTH)]}>
            <SymbolView name={sym('arrow.down')} size={12} tintColor={colors.inkSecondary} />
            <T variant="footnote" maxScale={1.3} numberOfLines={2} style={{ flex: 1 }}>
              {s.player.dockHint}
            </T>
          </View>
        </Pressable>
      ) : null}
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { minHeight: 36, justifyContent: 'center', paddingVertical: 6 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20 },
});
