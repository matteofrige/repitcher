import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { s } from '../i18n';
import type { Track } from '../lib/library';
import { formatTrackNote } from '../lib/trackNote';
import { formatAccessibility } from '../lib/tuning';
import { useColors } from '../theme';
import { numerals, T } from '../theme/type';
import { sym } from '../lib/icons';

type Props = {
  track: Track;
  /** Ordinal numeral shown at the left (playlists, where order matters). */
  ordinal?: number;
  playing?: boolean;
  selected?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Trailing control (e.g. ellipsis button). */
  trailing?: ReactNode;
  showAnnotation?: boolean;
  accessibilityHint?: string;
};

export function TrackRow({
  track,
  ordinal,
  playing,
  selected,
  onPress,
  onLongPress,
  trailing,
  showAnnotation = true,
  accessibilityHint,
}: Props) {
  const colors = useColors();
  const annotation = showAnnotation ? formatTrackNote(track) : '';
  const label = [
    track.title,
    track.override ? s.trackNote.ownTuningSpoken(formatAccessibility({ ...track.override, refHz: 440 })) : null,
    playing ? s.common.nowPlaying : null,
    selected ? s.trackNote.selected : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={selected === undefined ? undefined : { selected }}
        // No handlers (e.g. playlist edit mode): not a target, so no pressed highlight or VoiceOver "button".
        disabled={!onPress && !onLongPress}
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [styles.main, pressed && { backgroundColor: colors.plate }]}>
        {ordinal !== undefined ? (
          <T variant="callout" tone="inkSecondary" style={styles.ordinal} maxScale={1.3}>
            {ordinal}
          </T>
        ) : null}
        {selected !== undefined ? (
          <View style={styles.check}>
            <SymbolView
              name={selected ? sym('checkmark.circle.fill') : sym('circle')}
              size={24}
              tintColor={selected ? colors.tint : colors.inkSecondary}
            />
          </View>
        ) : null}
        <View style={styles.text}>
          <T variant="body" numberOfLines={2}>
            {track.title}
          </T>
          {playing ? (
            <View style={styles.meta}>
              <SymbolView name={sym('speaker.wave.2.fill')} size={13} tintColor={colors.tint} />
              <T variant="footnote" tone="tint">
                {s.common.nowPlaying}
              </T>
            </View>
          ) : null}
          {annotation ? (
            <T variant="annotation" numberOfLines={2} maxScale={1.3}>
              {annotation}
            </T>
          ) : null}
        </View>
      </Pressable>
      {trailing ?? <View style={{ width: 20 }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  main: {
    flex: 1,
    minHeight: 56,
    paddingLeft: 20,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ordinal: { width: 24, textAlign: 'right', fontVariant: numerals },
  check: { width: 24, alignItems: 'center' },
  text: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
