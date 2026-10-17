import { useState } from 'react';
import { View, type AccessibilityActionEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';

import { s } from '../i18n';
import { formatDuration } from '../lib/tuning';
import { useColors } from '../theme';
import { numerals, T } from '../theme/type';

type Props = {
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
};

const THUMB = 14;

export function SeekBar({ position, duration, onSeek }: Props) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);

  const [prevPosition, setPrevPosition] = useState(position);
  if (prevPosition !== position) {
    setPrevPosition(position);
    setDrag(null);
  }

  const shown = drag ?? position;
  const frac = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0;
  const usable = Math.max(1, width - THUMB);
  const fracFromX = (x: number) => {
    'worklet';
    return Math.min(1, Math.max(0, (x - THUMB / 2) / usable));
  };

  const setDragFrac = (f: number) => setDrag(f * duration);
  const commit = (f: number) => onSeek(f * duration);

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      scheduleOnRN(setDragFrac, fracFromX(e.x));
    })
    .onUpdate((e) => {
      scheduleOnRN(setDragFrac, fracFromX(e.x));
    })
    .onEnd((e) => {
      scheduleOnRN(commit, fracFromX(e.x));
    })
    .onFinalize((_e, success) => {
      if (!success) scheduleOnRN(setDrag, null);
    });

  const onAction = (e: AccessibilityActionEvent) => {
    const delta = e.nativeEvent.actionName === 'increment' ? 10 : -10;
    onSeek(Math.min(duration, Math.max(0, position + delta)));
  };

  const remaining = Math.max(0, duration - shown);

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={s.player.position}
          accessibilityValue={{
            text: s.player.positionValue(formatDuration(shown), formatDuration(duration)),
          }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={onAction}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          style={{ height: 44, justifyContent: 'center' }}>
          <View style={{ height: 2, backgroundColor: colors.rule, borderRadius: 1 }} />
          <View
            style={{
              position: 'absolute',
              left: THUMB / 2,
              height: 2,
              width: frac * usable,
              backgroundColor: colors.tint,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: frac * usable,
              width: THUMB,
              height: THUMB,
              borderRadius: THUMB / 2,
              backgroundColor: colors.tint,
            }}
          />
        </View>
      </GestureDetector>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: -6 }}>
        <T variant="footnote" style={{ fontVariant: numerals }}>
          {formatDuration(shown)}
        </T>
        <T variant="footnote" style={{ fontVariant: numerals }}>
          {`−${formatDuration(remaining)}`}
        </T>
      </View>
    </View>
  );
}
