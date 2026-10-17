import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';

import { SUPPORT_EMAIL, supportEmailConfigured } from '../config';
import { lang, s } from '../i18n';
import { showAlert } from './promptHost';

export { supportEmailConfigured };

export function appVersion(): string {
  return Constants.expoConfig?.version ?? '–';
}

function footer(): string {
  return [
    '',
    '—',
    `${s.feedback.footerApp}: RePitch ${appVersion()}`,
    `${s.feedback.footerOs}: ${Platform.OS === 'android' ? `API ${Platform.Version}` : Platform.Version}`,
    `${s.feedback.footerLanguage}: ${lang}`,
  ].join('\n');
}

async function composeMail(subject: string, hint: string): Promise<void> {
  if (!supportEmailConfigured()) return;
  const body = `${hint}\n\n${footer()}`;
  const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  try {
    await Linking.openURL(url);
  } catch {
    const i = await showAlert({
      title: s.feedback.noMailTitle,
      message: s.feedback.noMailMessage(SUPPORT_EMAIL),
      buttons: [{ label: s.feedback.cancel, style: 'cancel' }, { label: s.feedback.copyAddress }],
    });
    if (i === 1) void Clipboard.setStringAsync(SUPPORT_EMAIL);
  }
}

export function sendSuggestion() {
  return composeMail(s.feedback.suggestionSubject, s.feedback.suggestionHint);
}

export function sendProblemReport() {
  return composeMail(s.feedback.problemSubject, s.feedback.problemHint);
}
