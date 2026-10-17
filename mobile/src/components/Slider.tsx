import { useState } from 'react';
import { View, type AccessibilityActionEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';

import { useColors } from '../theme';

const THUMB = 14;

type Props = {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label: string;
  /** Spoken value, e.g. "120 BPM". */
  valueText?: string;
};

/** Hairline track, tint progress, 14pt thumb; 44pt touch height. Reports on every change. */
export function Slider({ value, min, max, step = 1, onChange, label, valueText }: Props) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const usable = Math.max(1, width - THUMB);
  const frac = Math.min(1, Math.max(0, (value - min) / (max - min)));

  const fromX = (x: number) => {
    const f = Math.min(1, Math.max(0, (x - THUMB / 2) / usable));
    return Math.round((min + f * (max - min)) / step) * step;
  };
  const emit = (x: number) => {
    const v = fromX(x);
    if (v !== value) onChange(v);
  };

  const gesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      scheduleOnRN(emit, e.x);
    })
    .onUpdate((e) => {
      scheduleOnRN(emit, e.x);
    });

  const onAction = (e: AccessibilityActionEvent) => {
    const d = e.nativeEvent.actionName === 'increment' ? step : -step;
    onChange(Math.min(max, Math.max(min, value + d)));
  };

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: valueText ?? String(value) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAction}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ height: 44, justifyContent: 'center' }}>
        <View style={{ height: 2, backgroundColor: colors.rule, borderRadius: 1 }} />
        <View
          style={{ position: 'absolute', left: THUMB / 2, height: 2, width: frac * usable, backgroundColor: colors.tint }}
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
  );
}
