import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Hairline } from '../components/Controls';
import { showAlert } from '../lib/promptHost';
import { Paper } from '../components/Paper';
import { s } from '../i18n';
import { applyBackup, exportBackup, pickBackup } from '../lib/backup';
import { clearPendingRestore, usePendingRestore } from '../lib/library';
import { useColors } from '../theme';
import { column } from '../theme/layout';
import { T } from '../theme/type';
import { sym } from '../lib/icons';

const MAX_LISTED = 10;

function Row({
  symbol,
  label,
  onPress,
  busy,
}: {
  symbol: SymbolViewProps['name'];
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!busy, busy: !!busy }}
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => ({
        minHeight: 48,
        paddingHorizontal: 20,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        opacity: pressed || busy ? 0.55 : 1,
      })}>
      <SymbolView name={symbol} size={20} tintColor={colors.tint} resizeMode="scaleAspectFit" style={{ width: 24, height: 24 }} />
      <T variant="body" style={{ flex: 1 }}>
        {label}
      </T>
      {busy ? <ActivityIndicator color={colors.tint} /> : null}
    </Pressable>
  );
}

export default function BackupScreen() {
  const pending = usePendingRestore();
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) =>
    showAlert({ title: s.backup.errorTitle, message: e instanceof Error && e.message ? e.message : s.backup.errorRead });

  const doExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await exportBackup())) await showAlert({ title: s.backup.errorTitle, message: s.backup.errorShare });
    } catch (e) {
      console.warn('RePitch: export backup failed', e);
      await showAlert({ title: s.backup.errorTitle, message: s.backup.errorShare });
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await pickBackup();
      if (data === null) return;
      const choice = await showAlert({
        title: s.backup.confirmTitle,
        message: s.backup.confirmMessage,
        buttons: [{ label: s.backup.cancel, style: 'cancel' }, { label: s.backup.confirm }],
      });
      const ok = choice === 1;
      if (!ok) return;
      const r = applyBackup(data);
      await showAlert({ title: s.backup.doneTitle, message: s.backup.report(r.matched, r.pending) });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const listed = pending.slice(0, MAX_LISTED);

  // Dropping the pending settings can't be undone without restoring again: confirm first.
  const confirmForget = async () => {
    const i = await showAlert({
      title: s.backup.forgetTitle,
      message: s.backup.forgetMessage,
      buttons: [
        { label: s.backup.cancel, style: 'cancel' },
        { label: s.backup.forget, style: 'destructive' },
      ],
    });
    if (i === 1) clearPendingRestore();
  };

  return (
    <Paper>
      <SafeAreaView style={{ flex: 1 }} edges={Platform.OS === 'android' ? ['top', 'bottom'] : ['top']}>
        <View style={[{ alignItems: 'flex-end', paddingHorizontal: 20, height: 44, justifyContent: 'center' }, column()]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.backup.done}
            onPress={() => router.back()}
            hitSlop={8}
            style={{ minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' }}>
            <T variant="headline" tone="tint">
              {s.backup.done}
            </T>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[{ paddingTop: 8, paddingBottom: 48, gap: 24 }, column()]}>
          <View style={{ paddingHorizontal: 20, gap: 14 }}>
            <T variant="largeTitle" accessibilityRole="header">
              {s.backup.title}
            </T>
            <T variant="body">{s.backup.intro}</T>
          </View>

          <View>
            <Hairline />
            <Row symbol={sym('square.and.arrow.up')} label={s.backup.export} busy={busy} onPress={() => void doExport()} />
            <Hairline />
            <Row symbol={sym('arrow.counterclockwise')} label={s.backup.restore} busy={busy} onPress={() => void doRestore()} />
            <Hairline />
          </View>

          {pending.length > 0 ? (
            <View style={{ paddingHorizontal: 20, gap: 6 }}>
              <T variant="headline" accessibilityRole="header">
                {s.backup.pendingTitle(pending.length)}
              </T>
              <T variant="annotation">{s.backup.pendingBody}</T>
              {listed.map((p, i) => (
                <T key={`${i}-${p.key.title}`} variant="annotation" numberOfLines={1}>
                  {`• ${p.key.title}`}
                </T>
              ))}
              {pending.length > MAX_LISTED ? (
                <T variant="annotation">{s.backup.andOthers(pending.length - MAX_LISTED)}</T>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.backup.forgetA11y}
                onPress={confirmForget}
                style={({ pressed }) => ({ minHeight: 44, minWidth: 44, justifyContent: 'center', alignSelf: 'flex-start', opacity: pressed ? 0.55 : 1 })}>
                <T variant="callout" tone="tint">
                  {s.backup.forget}
                </T>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Paper>
  );
}
