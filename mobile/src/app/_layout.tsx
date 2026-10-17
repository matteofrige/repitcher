import {
  IMFellEnglish_400Regular,
  IMFellEnglish_400Regular_Italic,
} from '@expo-google-fonts/im-fell-english';
import {
  LibreCaslonText_400Regular,
  LibreCaslonText_400Regular_Italic,
  LibreCaslonText_700Bold,
} from '@expo-google-fonts/libre-caslon-text';
import { NotoMusic_400Regular } from '@expo-google-fonts/noto-music';
import { useFonts } from 'expo-font';
import * as ScreenOrientation from 'expo-screen-orientation';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Dimensions, Platform, Settings } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { BeatFlash } from '../components/BeatFlash';
import { PromptHost } from '../components/PromptHost';
import { runDemo } from '../lib/demo';
import { loadLibrary, useLibraryLoaded } from '../lib/library';
import { initMetronome } from '../lib/metronome';
import { getPrefs } from '../lib/prefs';
import { initReview } from '../lib/review';
import { useInitPlayer } from '../lib/player';
import { ThemeProvider, useTheme } from '../theme';
import { fonts } from '../theme/type';

void SplashScreen.preventAutoHideAsync();

// Android phones stay portrait; tablets (sw >= 600 dp) rotate freely (Android 16 ignores orientation
// locks on large screens anyway). iOS needs nothing: Info.plist already limits the iPhone to portrait.
if (Platform.OS === 'android') {
  const { width, height } = Dimensions.get('screen');
  if (Math.min(width, height) < 600) {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }
}
// Screenshots only: scripts/sim-screens.sh passes `-RePitchPortrait 1`, because a headless iPad simulator
// boots in landscape and can't be rotated from the command line.
if (Platform.OS === 'ios' && Settings.get('RePitchPortrait')) {
  void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
}

function Navigator() {
  const { colors, scheme } = useTheme();
  useInitPlayer();
  useEffect(() => {
    initMetronome();
    initReview();
  }, []);
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.paper },
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerShadowVisible: false,
          headerTintColor: colors.tint,
          headerTitleStyle: { fontFamily: fonts.fell, color: colors.ink },
          headerBackButtonDisplayMode: 'minimal',
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="playlist/[id]" options={{ headerShown: false }} />
        <Stack.Screen
          name="player"
          options={{ presentation: 'modal', headerShown: false, gestureEnabled: true }}
        />
        <Stack.Screen
          name="guida"
          options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }}
        />
        <Stack.Screen name="about" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="backup" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen
          name="add-to-playlist"
          options={{ presentation: 'modal', headerShown: false }}
        />
      </Stack>
      <BeatFlash />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    IMFellEnglish_400Regular,
    IMFellEnglish_400Italic: IMFellEnglish_400Regular_Italic,
    LibreCaslonText_400Regular,
    LibreCaslonText_400Italic: LibreCaslonText_400Regular_Italic,
    LibreCaslonText_700Bold,
    NotoMusic_400Regular,
  });
  const libraryLoaded = useLibraryLoaded();

  useEffect(() => {
    void loadLibrary();
  }, []);

  const ready = fontsLoaded && libraryLoaded;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  // At launch, once: a route from the launch settings (scripts/sim-screens.sh passes
  // `-RePitchRoute <path>`; iOS stores it in the defaults, which avoids the system "open in
  // RePitch?" prompt that `simctl openurl` triggers), otherwise the guide on first run.
  useEffect(() => {
    if (!ready) return;
    const route = Platform.OS === 'ios' ? Settings.get('RePitchRoute') : null;
    if (typeof route === 'string' && route) router.push(route as never);
    else if (!getPrefs().onboardingDone) router.push('/guida' as never);
    // Video tooling only: `-RePitchDemo <scene>` scripts the scene (src/lib/demo.ts).
    const demo = Platform.OS === 'ios' ? Settings.get('RePitchDemo') : null;
    if (typeof demo === 'string' && demo) runDemo(demo);
  }, [ready]);

  if (!ready) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <Navigator />
        <PromptHost />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
