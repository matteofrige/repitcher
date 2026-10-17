import * as StoreReview from 'expo-store-review';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '../components/BrandMark';
import { Hairline } from '../components/Controls';
import { Paper } from '../components/Paper';
import { APP_STORE_ID, SITE_URL } from '../config';
import { lang, s } from '../i18n';
import { appVersion, sendProblemReport, sendSuggestion, supportEmailConfigured } from '../lib/feedback';
import { BEAT_THIS_LICENSE, SIGNALSMITH_LINEAR_LICENSE, SIGNALSMITH_STRETCH_LICENSE } from '../lib/licenses';
import { markRated } from '../lib/review';
import { useColors } from '../theme';
import { column } from '../theme/layout';
import { T } from '../theme/type';
import { sym } from '../lib/icons';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <T variant="headline" accessibilityRole="header" style={{ paddingHorizontal: 20 }}>
        {title}
      </T>
      <View>{children}</View>
    </View>
  );
}

function Row({
  symbol,
  label,
  onPress,
  chevron = sym('chevron.right'),
}: {
  symbol: SymbolViewProps['name'];
  label: string;
  onPress: () => void;
  chevron?: SymbolViewProps['name'];
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        paddingHorizontal: 20,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        opacity: pressed ? 0.55 : 1,
      })}>
      <SymbolView name={symbol} size={20} tintColor={colors.tint} resizeMode="scaleAspectFit" style={{ width: 24, height: 24 }} />
      <T variant="body" style={{ flex: 1 }}>
        {label}
      </T>
      <SymbolView name={chevron} size={13} tintColor={colors.pencil} resizeMode="scaleAspectFit" style={{ width: 16, height: 16 }} />
    </Pressable>
  );
}

export default function AboutScreen() {
  const colors = useColors();
  const [canReview, setCanReview] = useState(false);
  const [licenseOpen, setLicenseOpen] = useState(false);
  const mail = supportEmailConfigured();

  useEffect(() => {
    let alive = true;
    StoreReview.hasAction()
      .then((ok) => alive && setCanReview(ok))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const rate = async () => {
    try {
      if (await StoreReview.hasAction()) {
        await StoreReview.requestReview();
        markRated();
        return;
      }
    } catch {}
    if (APP_STORE_ID) {
      void Linking.openURL(`https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`);
      markRated();
    }
  };

  const showRate = canReview || !!APP_STORE_ID;

  return (
    <Paper>
      <SafeAreaView style={{ flex: 1 }} edges={Platform.OS === 'android' ? ['top', 'bottom'] : ['top']}>
        <View style={[{ alignItems: 'flex-end', paddingHorizontal: 20, height: 44, justifyContent: 'center' }, column()]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.about.done}
            onPress={() => router.back()}
            hitSlop={8}
            style={{ minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' }}>
            <T variant="headline" tone="tint">
              {s.about.done}
            </T>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[{ paddingTop: 8, paddingBottom: 48, gap: 28 }, column()]}>
          <View style={{ paddingHorizontal: 20, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <BrandMark size={72} />
              <View style={{ flexShrink: 1 }}>
                <T variant="largeTitle" accessibilityRole="header">
                  RePitch
                </T>
                <T variant="footnote">{s.about.version(appVersion())}</T>
              </View>
            </View>
            <T variant="body">{s.about.description}</T>
            <T variant="annotation">{s.about.privacyLine}</T>
          </View>

          {mail || showRate ? (
            <Section title={s.about.helpHeader}>
              {mail ? (
                <>
                  <Hairline />
                  <Row symbol={sym('lightbulb')} label={s.about.suggest} onPress={() => void sendSuggestion()} />
                  <Hairline />
                  <Row symbol={sym('exclamationmark.bubble')} label={s.about.report} onPress={() => void sendProblemReport()} />
                </>
              ) : null}
              {showRate ? (
                <>
                  <Hairline />
                  <Row symbol={sym('star')} label={s.about.rate} onPress={() => void rate()} />
                </>
              ) : null}
              <Hairline />
            </Section>
          ) : null}

          <Section title={s.about.guideHeader}>
            <Hairline />
            <Row symbol={sym('book')} label={s.about.reviewGuide} onPress={() => router.push('/guida' as never)} />
            <Hairline />
          </Section>

          <Section title={s.about.dataHeader}>
            <Hairline />
            <Row symbol={sym('icloud.and.arrow.up')} label={s.about.backupRow} onPress={() => router.push('/backup' as never)} />
            <Hairline />
          </Section>

          {SITE_URL ? (
            <Section title={s.about.privacyHeader}>
              <Hairline />
              <Row
                symbol={sym('hand.raised')}
                label={s.about.privacyPolicy}
                onPress={() => void WebBrowser.openBrowserAsync(`${SITE_URL}${lang === 'it' ? '' : '/en'}/privacy.html`)}
              />
              <Hairline />
            </Section>
          ) : null}

          <Section title={s.about.creditsHeader}>
            <Hairline />
            <View style={{ paddingHorizontal: 20, paddingVertical: 12, gap: 4 }}>
              <T variant="footnote">{s.about.audioEngine}</T>
              <T variant="body">{s.about.audioEngineValue}</T>
            </View>
            <View style={{ paddingHorizontal: 20, paddingBottom: 12, gap: 4 }}>
              <T variant="footnote">{s.about.beatDetection}</T>
              <T variant="body">{s.about.beatDetectionValue}</T>
            </View>
            <Row
              symbol={sym('doc.text')}
              label={licenseOpen ? s.about.licenseHide : s.about.licenseShow}
              chevron={licenseOpen ? sym('chevron.up') : sym('chevron.down')}
              onPress={() => setLicenseOpen((v) => !v)}
            />
            {licenseOpen ? (
              <View style={{ paddingHorizontal: 20, paddingVertical: 12, gap: 14, backgroundColor: colors.plate }}>
                <T variant="caption" selectable>
                  {SIGNALSMITH_STRETCH_LICENSE}
                </T>
                <T variant="caption" selectable>
                  {SIGNALSMITH_LINEAR_LICENSE}
                </T>
                <T variant="caption" selectable>
                  {BEAT_THIS_LICENSE}
                </T>
              </View>
            ) : null}
            <Hairline />
            <View style={{ paddingHorizontal: 20, paddingVertical: 12, gap: 4 }}>
              <T variant="footnote">{s.about.fontsLabel}</T>
              {s.about.fonts.map((f) => (
                <T key={f} variant="body">
                  {f}
                </T>
              ))}
              <T variant="footnote">{s.about.fontsLicense}</T>
            </View>
            <Hairline />
          </Section>
        </ScrollView>
      </SafeAreaView>
    </Paper>
  );
}
