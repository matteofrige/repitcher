import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { tick, Hairline } from '../components/Controls';
import { Paper } from '../components/Paper';
import { PromptHost } from '../components/PromptHost';
import { s } from '../i18n';
import { sym } from '../lib/icons';
import { setTools, useTools } from '../lib/library';
import { showAlert, showPrompt } from '../lib/promptHost';
import { MAX_CUSTOM_CENTS, TEMPERAMENT_IDS, hasTonic, temperamentOffsets, type TemperamentId } from '../lib/temperaments';
import { NOTE_NAMES } from '../lib/tuner';
import { useColors } from '../theme';
import { column } from '../theme/layout';
import { T, fonts, numerals } from '../theme/type';

const CHIP_GAP = 6;

/** Cents with one decimal, decimal comma and a real minus sign ("+5,9", "−2,0", "0"). */
const fmt = (c: number) => (Math.abs(c) < 0.05 ? '0' : `${c > 0 ? '+' : '−'}${Math.abs(c).toFixed(1).replace('.', ',')}`);

export default function TemperamentScreen() {
  const colors = useColors();
  const tools = useTools();
  const { temperament, temperamentTonic, customCents } = tools;
  const offsets = temperamentOffsets(tools);
  const isCustom = temperament === 'custom';
  // Custom values are shown as typed; the others are the (A-normalised) offsets actually used.
  const shown = isCustom ? customCents : offsets;

  const choose = (id: TemperamentId) => {
    if (id === temperament) return;
    tick();
    setTools({ temperament: id });
  };
  const chooseTonic = (pc: number) => {
    if (pc === temperamentTonic) return;
    tick();
    setTools({ temperamentTonic: pc });
  };

  const editCell = async (pc: number) => {
    const text = await showPrompt({
      title: s.temperament.customTitle(NOTE_NAMES[pc]),
      message: s.temperament.customBody(MAX_CUSTOM_CENTS),
      defaultValue: customCents[pc] === 0 ? '' : String(customCents[pc]).replace('.', ','),
      keyboardType: 'numbers-and-punctuation',
      confirmLabel: s.common.set,
    });
    if (text === null) return;
    const v = Math.round(parseFloat(text.trim().replace(',', '.').replace('−', '-')) * 10) / 10;
    if (!Number.isFinite(v) || Math.abs(v) > MAX_CUSTOM_CENTS) {
      void showAlert({ title: s.common.invalidValue, message: s.temperament.customInvalid(MAX_CUSTOM_CENTS) });
      return;
    }
    tick();
    setTools({ customCents: customCents.map((c, i) => (i === pc ? v : c)) });
  };

  return (
    <Paper>
      <SafeAreaView style={{ flex: 1 }} edges={Platform.OS === 'android' ? ['top', 'bottom'] : ['top']}>
        <View style={[{ alignItems: 'flex-end', paddingHorizontal: 20, height: 44, justifyContent: 'center' }, column()]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.common.done}
            onPress={() => router.back()}
            hitSlop={8}
            style={{ minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' }}>
            <T variant="headline" tone="tint">
              {s.common.done}
            </T>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[{ paddingTop: 8, paddingBottom: 48, gap: 20 }, column()]}>
          <View style={{ paddingHorizontal: 20, gap: 6 }}>
            <T variant="largeTitle" accessibilityRole="header">
              {s.temperament.title}
            </T>
            <T variant="footnote">{s.temperament.intro}</T>
          </View>

          <View accessibilityRole="radiogroup" accessibilityLabel={s.temperament.title}>
            <Hairline />
            {TEMPERAMENT_IDS.map((id) => {
              const selected = id === temperament;
              return (
                <View key={id}>
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${s.temperament.names[id]}. ${s.temperament.descriptions[id]}`}
                    onPress={() => choose(id)}
                    style={({ pressed }) => ({
                      minHeight: 52,
                      paddingHorizontal: 20,
                      paddingVertical: 8,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      opacity: pressed ? 0.55 : 1,
                    })}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <T variant="body">{s.temperament.names[id]}</T>
                      <T variant="footnote">{s.temperament.descriptions[id]}</T>
                    </View>
                    <View style={{ width: 20, height: 20 }}>
                      {selected ? (
                        <SymbolView name={sym('checkmark')} size={18} tintColor={colors.tint} resizeMode="scaleAspectFit" style={{ width: 20, height: 20 }} />
                      ) : null}
                    </View>
                  </Pressable>
                  <Hairline />
                </View>
              );
            })}
          </View>

          {hasTonic(temperament) ? (
            <View style={{ paddingHorizontal: 20, gap: 8 }}>
              <T variant="callout" accessibilityRole="header">
                {s.temperament.tonic}
              </T>
              <View accessibilityRole="radiogroup" accessibilityLabel={s.temperament.tonic} style={styles.chips}>
                {NOTE_NAMES.map((name, pc) => {
                  const selected = pc === temperamentTonic;
                  return (
                    <Pressable
                      key={name}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={name}
                      onPress={() => chooseTonic(pc)}
                      style={[
                        styles.chip,
                        { backgroundColor: selected ? colors.tint : 'transparent', borderColor: selected ? colors.tint : colors.rule },
                      ]}>
                      <Text
                        allowFontScaling
                        maxFontSizeMultiplier={1.3}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        style={{ fontFamily: fonts.caslon, fontSize: 16, color: selected ? colors.paper : colors.ink }}>
                        {name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={{ paddingHorizontal: 20, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <T variant="callout" accessibilityRole="header" style={{ flexShrink: 1 }}>
                {s.temperament.deviations}
              </T>
              {isCustom ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={s.temperament.resetA11y}
                  onPress={() => {
                    tick();
                    setTools({ customCents: new Array<number>(12).fill(0) });
                  }}
                  hitSlop={8}
                  style={{ minHeight: 44, justifyContent: 'center' }}>
                  <T variant="body" tone="tint">
                    {s.temperament.reset}
                  </T>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.grid}>
              {NOTE_NAMES.map((name, pc) => {
                const value = fmt(shown[pc] ?? 0);
                const cell = (
                  <>
                    <T variant="footnote">{name}</T>
                    <Text
                      allowFontScaling
                      maxFontSizeMultiplier={1.3}
                      style={{ fontFamily: fonts.caslon, fontVariant: numerals, fontSize: 17, color: colors.ink }}>
                      {value}
                    </Text>
                  </>
                );
                return isCustom ? (
                  <Pressable
                    key={name}
                    accessibilityRole="button"
                    accessibilityLabel={s.temperament.cellA11y(name, value)}
                    onPress={() => void editCell(pc)}
                    style={({ pressed }) => [styles.cell, { borderColor: colors.rule, opacity: pressed ? 0.55 : 1 }]}>
                    {cell}
                  </Pressable>
                ) : (
                  <View key={name} accessible accessibilityLabel={s.temperament.cellA11y(name, value)} style={[styles.cell, { borderColor: colors.rule }]}>
                    {cell}
                  </View>
                );
              })}
            </View>
            {isCustom ? <T variant="footnote">{s.temperament.customFootnote}</T> : null}
          </View>
        </ScrollView>
      </SafeAreaView>
      <PromptHost />
    </Paper>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: CHIP_GAP },
  chip: {
    minHeight: 44,
    minWidth: 44,
    flexGrow: 1,
    flexBasis: '14%',
    paddingHorizontal: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: CHIP_GAP },
  cell: {
    minHeight: 44,
    flexBasis: '22%',
    flexGrow: 1,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
