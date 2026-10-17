import { useState } from 'react';
import { Image, StyleSheet, View, type LayoutChangeEvent, type ViewProps } from 'react-native';

import { useTheme } from '../theme';

const grainLight = require('../../assets/textures/paper-grain-light.png');
const grainDark = require('../../assets/textures/paper-grain-dark.png');
const TILE = 512;

/**
 * Paper surface: the grain tile is paper-coloured noise at full opacity, so the field's mean
 * colour stays on the paper token (no darker band against flat headers).
 * Tiled by hand: iOS `resizeMode="repeat"` does not repeat vertically.
 */
export function Paper({ style, children, onLayout, ...rest }: ViewProps) {
  const { colors, scheme } = useTheme();
  const grain = scheme === 'dark' ? grainDark : grainLight;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
    onLayout?.(e);
  };
  const cols = Math.ceil(size.w / TILE);
  const rows = Math.ceil(size.h / TILE);
  const tiles: { key: string; left: number; top: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) tiles.push({ key: `${r}-${c}`, left: c * TILE, top: r * TILE });
  }

  return (
    <View
      {...rest}
      onLayout={handleLayout}
      style={[{ flex: 1, backgroundColor: colors.paper }, style]}>
      <View
        pointerEvents="none"
        accessible={false}
        style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
        {tiles.map((t) => (
          <Image
            key={t.key}
            source={grain}
            style={{ position: 'absolute', left: t.left, top: t.top, width: TILE, height: TILE }}
          />
        ))}
      </View>
      {children}
    </View>
  );
}
