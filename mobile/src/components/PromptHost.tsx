import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  clearCurrent,
  registerHost,
  type AlertButton,
  type AlertOptions,
  type HostRequest,
  type PromptOptions,
  type SheetOptions,
} from '../lib/promptHost';
import { useColors } from '../theme';
import { T, fonts } from '../theme/type';

/**
 * In-app UI for showPrompt / showActionSheet / showAlert, the same on iOS and Android.
 * Mount once, inside ThemeProvider.
 */
export function PromptHost() {
  const [req, setReq] = useState<HostRequest | null>(null);
  useEffect(() => {
    registerHost(setReq);
    return () => registerHost(null);
  }, []);

  const finish = (r: HostRequest, value: string | number | null) => {
    clearCurrent(r);
    setReq(null);
    (r.resolve as (v: string | number | null) => void)(value);
  };

  if (req?.kind === 'prompt') {
    return <PromptDialog key={req.id} opts={req.opts} onDone={(v) => finish(req, v)} />;
  }
  if (req?.kind === 'sheet') {
    return <SheetDialog key={req.id} opts={req.opts} onDone={(v) => finish(req, v)} />;
  }
  if (req?.kind === 'alert') {
    return <AlertDialog key={req.id} opts={req.opts} onDone={(v) => finish(req, v)} />;
  }
  return null;
}

function AlertDialog({
  opts,
  onDone,
}: {
  opts: AlertOptions & { buttons: AlertButton[] };
  onDone: (v: number | null) => void;
}) {
  const colors = useColors();
  const { buttons } = opts;
  const cancelIndex = buttons.findIndex((b) => b.style === 'cancel');
  const dismiss = () => onDone(cancelIndex >= 0 ? cancelIndex : null);
  const stacked = buttons.length >= 3 || buttons.reduce((n, b) => n + b.label.length, 0) > 30;
  // The last non-cancel button is the primary one.
  let primary = -1;
  buttons.forEach((b, i) => {
    if (b.style !== 'cancel') primary = i;
  });
  const rows = buttons.map((b, i) => (
    <TextButton
      key={i}
      label={b.label}
      bold={i === primary}
      color={b.style === 'destructive' ? colors.danger : b.style === 'cancel' ? colors.inkSecondary : undefined}
      fill={stacked}
      onPress={() => onDone(i)}
    />
  ));
  return (
    <Modal
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      visible
      onRequestClose={dismiss}>
      <View style={styles.center}>
        <Pressable accessible={false} style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} onPress={dismiss} />
        <View
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.paper, borderColor: colors.rule }]}>
          <T variant="headline" style={{ fontFamily: fonts.fell }} accessibilityRole="header">
            {opts.title}
          </T>
          {opts.message ? (
            <T variant="body" style={{ marginTop: 8 }}>
              {opts.message}
            </T>
          ) : null}
          <View style={stacked ? styles.actionsStacked : styles.actions}>{rows}</View>
        </View>
      </View>
    </Modal>
  );
}

function PromptDialog({ opts, onDone }: { opts: PromptOptions; onDone: (v: string | null) => void }) {
  const colors = useColors();
  const [value, setValue] = useState(opts.defaultValue ?? '');
  const [focused, setFocused] = useState(false);
  return (
    <Modal
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      visible
      onRequestClose={() => onDone(null)}>
      <KeyboardAvoidingView behavior="padding" style={styles.center}>
        <Pressable
          accessible={false}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
          onPress={() => onDone(null)}
        />
        <View
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.paper, borderColor: colors.rule }]}>
          <T variant="headline" style={{ fontFamily: fonts.fell }} accessibilityRole="header">
            {opts.title}
          </T>
          {opts.message ? (
            <T variant="footnote" style={{ marginTop: 6 }}>
              {opts.message}
            </T>
          ) : null}
          <TextInput
            autoFocus
            selectTextOnFocus
            value={value}
            onChangeText={setValue}
            placeholder={opts.placeholder}
            placeholderTextColor={colors.pencil}
            keyboardType={opts.keyboardType}
            returnKeyType="done"
            onSubmitEditing={() => onDone(value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            cursorColor={colors.tint}
            selectionColor={colors.tint}
            accessibilityLabel={opts.title}
            maxFontSizeMultiplier={1.4}
            style={{
              marginTop: 16,
              minHeight: 48,
              paddingHorizontal: 2,
              paddingVertical: 8,
              fontFamily: fonts.caslon,
              fontSize: 17,
              color: colors.ink,
              borderBottomWidth: focused ? 2 : StyleSheet.hairlineWidth * 2,
              borderBottomColor: focused ? colors.tint : colors.rule,
            }}
          />
          <View style={styles.actions}>
            <TextButton label={opts.cancelLabel ?? ''} onPress={() => onDone(null)} />
            <TextButton label={opts.confirmLabel ?? ''} bold onPress={() => onDone(value)} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TextButton({
  label,
  onPress,
  bold,
  color,
  fill,
}: {
  label: string;
  onPress: () => void;
  bold?: boolean;
  color?: string;
  fill?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      android_ripple={{ color: colors.rule, borderless: false }}
      style={({ pressed }) => ({
        minHeight: 48,
        minWidth: 64,
        alignSelf: fill ? 'stretch' : undefined,
        paddingHorizontal: 12,
        borderRadius: 8,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.55 : 1,
      })}>
      <T
        variant={bold ? 'headline' : 'callout'}
        tone="tint"
        maxScale={1.3}
        style={color ? { color } : undefined}>
        {label}
      </T>
    </Pressable>
  );
}

function SheetDialog({ opts, onDone }: { opts: SheetOptions; onDone: (v: number | null) => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      visible
      onRequestClose={() => onDone(null)}>
      <View style={styles.bottom}>
        <Pressable
          accessible={false}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
          onPress={() => onDone(null)}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.paper, borderColor: colors.rule, paddingBottom: Math.max(insets.bottom, 8) },
          ]}>
          {opts.title ? (
            <View style={{ paddingHorizontal: 20, paddingVertical: 14 }}>
              <T variant="footnote" numberOfLines={2} accessibilityRole="header">
                {opts.title}
              </T>
            </View>
          ) : null}
          <ScrollView style={{ maxHeight: height * 0.6 }} keyboardShouldPersistTaps="handled">
            {opts.options.map((o, i) => (
              <SheetRow key={i} label={o.label} danger={o.destructive} onPress={() => onDone(i)} />
            ))}
          </ScrollView>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.rule }} />
          <SheetRow label={opts.cancelLabel ?? ''} muted onPress={() => onDone(null)} />
        </View>
      </View>
    </Modal>
  );
}

function SheetRow({ label, onPress, danger, muted }: { label: string; onPress: () => void; danger?: boolean; muted?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      android_ripple={{ color: colors.rule }}
      style={{ minHeight: 48, paddingHorizontal: 20, justifyContent: 'center' }}>
      <T variant="body" maxScale={1.4} style={{ color: danger ? colors.danger : muted ? colors.inkSecondary : colors.ink }}>
        {label}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingTop: 22,
    paddingHorizontal: 22,
    paddingBottom: 10,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14, gap: 4 },
  actionsStacked: { marginTop: 10 },
  bottom: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
});
