import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { sym, type SymbolName } from '../lib/icons';
import { useColors } from '../theme';
import { T } from '../theme/type';

export function tick() {
  void Haptics.selectionAsync().catch(() => {});
}

type IconButtonProps = {
  symbol: SymbolName;
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  disabled?: boolean;
  /** Palette key; defaults to tint. */
  tone?: 'tint' | 'ink' | 'inkSecondary' | 'danger' | 'pencil';
  size?: number;
  /** Hit target (>= 44). */
  hit?: number;
  style?: StyleProp<ViewStyle>;
};

/** Symbol button with a >=44pt hit area. */
export function IconButton({
  symbol,
  label,
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  disabled,
  tone = 'tint',
  size = 22,
  hit = 44,
  style,
}: IconButtonProps) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      hitSlop={4}
      style={({ pressed }) => [
        { width: hit, height: hit, alignItems: 'center', justifyContent: 'center' },
        { opacity: disabled ? 0.35 : pressed ? 0.55 : 1 },
        style,
      ]}>
      <SymbolView name={symbol} size={size} tintColor={colors[tone]} resizeMode="scaleAspectFit" />
    </Pressable>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  symbol?: SymbolName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Primary: tint fill with paper text. Secondary: tint outline. Danger: danger outline. 44pt+, radius 10. */
export function Button({ label, onPress, kind = 'primary', symbol, disabled, style }: ButtonProps) {
  const colors = useColors();
  const primary = kind === 'primary';
  const accent = kind === 'danger' ? colors.danger : colors.tint;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary
          ? { backgroundColor: pressed ? colors.tintPressed : colors.tint }
          : { borderColor: accent, borderWidth: StyleSheet.hairlineWidth * 2, opacity: pressed ? 0.6 : 1 },
        disabled && { opacity: 0.4 },
        style,
      ]}>
      {symbol ? (
        <SymbolView
          name={symbol}
          size={17}
          tintColor={primary ? colors.paper : accent}
          resizeMode="scaleAspectFit"
        />
      ) : null}
      <T variant="headline" numberOfLines={1} style={{ color: primary ? colors.paper : accent }}>
        {label}
      </T>
    </Pressable>
  );
}

/** Inset hairline between list rows. */
export function Hairline({ inset = 20 }: { inset?: number }) {
  const colors = useColors();
  return (
    <View style={{ height: StyleSheet.hairlineWidth, marginLeft: inset, backgroundColor: colors.rule }} />
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});

type StepperProps = {
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled: boolean;
  plusDisabled: boolean;
  minusLabel: string;
  plusLabel: string;
  /** Press-and-hold repeats (350 ms delay, then every 80 ms). */
  holdable?: boolean;
  /** Content between the two buttons (e.g. the value). Without it: outlined − | + pair. */
  middle?: ReactNode;
  buttonWidth?: number;
};

/** − / + control with optional hold-to-repeat; 44pt+ targets. */
export function Stepper({
  onMinus,
  onPlus,
  minusDisabled,
  plusDisabled,
  minusLabel,
  plusLabel,
  holdable,
  middle,
  buttonWidth = 56,
}: StepperProps) {
  const colors = useColors();
  const timer = useRef<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null>(null);
  const count = useRef(0);

  const stop = () => {
    if (timer.current) {
      clearTimeout(timer.current as ReturnType<typeof setTimeout>);
      clearInterval(timer.current as ReturnType<typeof setInterval>);
      timer.current = null;
    }
  };
  useEffect(() => stop, []);

  // Latest handlers, so repeating timers never act on stale values.
  const fns = useRef({ onMinus, onPlus });
  useEffect(() => {
    fns.current = { onMinus, onPlus };
  });

  const start = (dir: 'onMinus' | 'onPlus') => {
    if (!holdable) return;
    stop();
    count.current = 0;
    timer.current = setTimeout(() => {
      timer.current = setInterval(() => {
        count.current += 1;
        fns.current[dir]();
        if (count.current % 5 === 0) tick();
      }, 80);
    }, 350);
  };

  const press = (dir: 'onMinus' | 'onPlus') => {
    fns.current[dir]();
    tick();
  };

  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center' },
        !middle && { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.tint, borderRadius: 8 },
      ]}>
      <IconButton
        symbol={sym('minus')}
        label={minusLabel}
        disabled={minusDisabled}
        onPressIn={() => start('onMinus')}
        onPressOut={stop}
        onPress={() => press('onMinus')}
        style={{ width: buttonWidth }}
      />
      {middle ?? (
        <View style={{ width: StyleSheet.hairlineWidth, height: 24, backgroundColor: colors.tint }} />
      )}
      <IconButton
        symbol={sym('plus')}
        label={plusLabel}
        disabled={plusDisabled}
        onPressIn={() => start('onPlus')}
        onPressOut={stop}
        onPress={() => press('onPlus')}
        style={{ width: buttonWidth }}
      />
    </View>
  );
}
