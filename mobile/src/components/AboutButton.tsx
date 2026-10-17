import { router } from 'expo-router';

import { s } from '../i18n';
import { IconButton } from './Controls';
import { sym } from '../lib/icons';

/** Opens the About sheet. Meant for the Intonazione header. */
export function AboutButton() {
  return <IconButton symbol={sym('info.circle')} label={s.about.openLabel} onPress={() => router.push('/about' as never)} />;
}
