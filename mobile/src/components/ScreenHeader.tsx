import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { s } from '../i18n';
import { sym } from '../lib/icons';
import { useColors } from '../theme';
import { T, fonts } from '../theme/type';

type Props = {
  title?: string;
  left?: ReactNode;
  right?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  /** Inside an iOS modal sheet, which doesn't sit under the status bar. */
  inModal?: boolean;
};

/** Fixed bar at the top of a screen, in place of the native navigation header. */
export function ScreenHeader({ title, left, right, onBack, backLabel, inModal }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const top = inModal && Platform.OS === 'ios' ? 8 : insets.top;
  return (
    <View
      style={[
        styles.bar,
        { paddingTop: top, backgroundColor: colors.paper, borderBottomColor: colors.rule },
      ]}>
      <View style={styles.row}>
        <View style={[styles.side, styles.sideLeft]}>
          {onBack ? <BackButton label={backLabel} onPress={onBack} /> : null}
          {left}
        </View>
        <View style={styles.center} pointerEvents="none">
          {title ? (
            <T variant="headline" numberOfLines={1} accessibilityRole="header" style={{ fontFamily: fonts.fell }}>
              {title}
            </T>
          ) : null}
        </View>
        <View style={[styles.side, styles.sideRight]}>{right}</View>
      </View>
    </View>
  );
}

function BackButton({ label, onPress }: { label?: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? s.common.back}
      onPress={onPress}
      style={({ pressed }) => [styles.back, { opacity: pressed ? 0.55 : 1 }]}>
      <SymbolView name={sym('chevron.left')} size={20} tintColor={colors.tint} resizeMode="scaleAspectFit" />
      {label ? (
        <T variant="callout" tone="tint" maxScale={1.3} numberOfLines={1}>
          {label}
        </T>
      ) : null}
    </Pressable>
  );
}

/** Text-only action for a ScreenHeader slot. */
export function HeaderTextButton({
  label,
  onPress,
  disabled,
  bold,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  bold?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.textBtn, { opacity: disabled ? 0.35 : pressed ? 0.55 : 1 }]}>
      <T variant={bold ? 'headline' : 'callout'} tone="tint" maxScale={1.3}>
        {label}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  // Equal-width sides keep the title centred; the title overlays the middle.
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', zIndex: 1 },
  sideLeft: { justifyContent: 'flex-start' },
  sideRight: { justifyContent: 'flex-end' },
  center: { position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 96 },
  back: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', gap: 2, maxWidth: 140 },
  textBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
});
