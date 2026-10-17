import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';

import { useTheme } from '../theme';

/** iOS sheets sit over a black backdrop: in light mode the dark status bar would vanish. */
export function SheetStatusBar() {
  const { scheme } = useTheme();
  if (Platform.OS !== 'ios' || scheme !== 'light') return null;
  return <StatusBar style="light" />;
}
