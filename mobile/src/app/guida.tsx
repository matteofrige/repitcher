import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';

import { Button, tick } from '../components/Controls';
import { Paper } from '../components/Paper';
import { s } from '../i18n';
import { sym } from '../lib/icons';
import { updatePrefs } from '../lib/prefs';
import { setGuideOpen } from '../lib/review';
import { useColors } from '../theme';
import { column } from '../theme/layout';
import { T } from '../theme/type';

const SYMBOLS: SymbolViewProps['name'][] = [
  sym('music.note'),
  sym('tuningfork'),
  sym('square.and.arrow.down'),
  sym('play.circle'),
  sym('metronome'),
];
const ART = 220;

/** A symbol inside a thin circle, over five staff lines. */
function Illustration({ symbol }: { symbol: SymbolViewProps['name'] }) {
  const colors = useColors();
  const width = 280;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ width, height: ART, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={width} height={ART} style={{ position: 'absolute' }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Line
            key={i}
            x1={0}
            x2={width}
            y1={ART / 2 - 40 + i * 20}
            y2={ART / 2 - 40 + i * 20}
            stroke={colors.rule}
            strokeWidth={1}
          />
        ))}
      </Svg>
      <View
        style={{
          width: 128,
          height: 128,
          borderRadius: 64,
          backgroundColor: colors.paper,
          borderWidth: 1,
          borderColor: colors.rule,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <SymbolView name={symbol} size={56} tintColor={colors.tint} resizeMode="scaleAspectFit" />
      </View>
    </View>
  );
}

export default function GuideScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const pages = s.guide.pages;
  const last = page === pages.length - 1;

  useEffect(() => {
    setGuideOpen(true);
    return () => setGuideOpen(false);
  }, []);

  // Android hardware/gesture back leaves the guide too: it counts as "seen" like Skip does.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      updatePrefs({ onboardingDone: true });
      return false; // let the navigator pop the screen
    });
    return () => sub.remove();
  }, []);

  const close = () => {
    updatePrefs({ onboardingDone: true });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  // Rotation / split-view resize changes the page width: keep the current page in view.
  useEffect(() => {
    scroll.current?.scrollTo({ x: page * width, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const goTo = (i: number) => {
    // onScroll updates the page as the animation passes the midpoint.
    scroll.current?.scrollTo({ x: i * width, animated: true });
  };

  // Page from the live scroll position (clamped), so dots and button follow the finger.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.max(0, Math.min(pages.length - 1, Math.round(e.nativeEvent.contentOffset.x / width)));
    if (i !== page) {
      setPage(i);
      tick();
    }
  };

  return (
    <Paper>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={[{ alignItems: 'flex-end', paddingHorizontal: 20, height: 44, justifyContent: 'center' }, column()]}>
          {/* Always visible: hiding it on the last page made it vanish early whenever the page index ran ahead. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.guide.skip}
            onPress={close}
            hitSlop={8}
            style={{ minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' }}>
            <T variant="callout" tone="tint">
              {s.guide.skip}
            </T>
          </Pressable>
        </View>

        <ScrollView
          ref={scroll}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={32}
          style={{ flex: 1 }}>
          {pages.map((p, i) => (
            <ScrollView
              key={i}
              style={{ width }}
              // The page stays window-wide for paging; its content sits in a centered column.
              contentContainerStyle={[
                { flexGrow: 1, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', gap: 28 },
                column(),
              ]}>
              <Illustration symbol={SYMBOLS[i]} />
              <View style={{ gap: 10, alignItems: 'center', maxWidth: 420 }}>
                <T variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
                  {p.title}
                </T>
                <T variant="body" tone="inkSecondary" style={{ textAlign: 'center' }}>
                  {p.text}
                </T>
              </View>
            </ScrollView>
          ))}
        </ScrollView>

        <View style={[{ paddingHorizontal: 20, paddingBottom: 12, gap: 20 }, column()]}>
          <View
            accessible
            accessibilityLabel={s.guide.pageOf(page + 1, pages.length)}
            style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
            {pages.map((_, i) => (
              <View
                key={i}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: i === page ? colors.tint : 'transparent',
                  borderWidth: 1,
                  borderColor: i === page ? colors.tint : colors.rule,
                }}
              />
            ))}
          </View>
          <Button label={last ? s.guide.start : s.guide.next} onPress={last ? close : () => goTo(page + 1)} />
        </View>
      </SafeAreaView>
    </Paper>
  );
}
