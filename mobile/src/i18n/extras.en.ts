import type { ExtrasStrings } from './extras.it';
import { pick } from './platform';

export const extras: ExtrasStrings = {
  guide: {
    skip: 'Skip',
    next: 'Next',
    start: 'Get started',
    pageOf: (n, total) => `Page ${n} of ${total}`,
    pages: [
      {
        title: 'Welcome to RePitch',
        text: 'RePitch tunes your recordings to your instrument, so you can play along with any track.',
      },
      {
        title: 'Your instrument’s A',
        text: 'In Tuning, set the frequency your instrument is tuned to, for example 442 Hz. It applies to all tracks; you can also transpose by semitones and fine-tune in cents.',
      },
      {
        title: 'Import your tracks',
        text: pick(
          'In Library, tap “Import” to add audio files from the Files app. RePitch detects each track’s A by itself and aligns it to yours.',
          'In Library, tap “Import” to add audio files from your file manager. RePitch detects each track’s A by itself and aligns it to yours.',
        ),
      },
      {
        title: 'Only this track',
        text: 'Open a track in the player to give it a tuning of its own. All other tracks keep the global tuning.',
      },
      {
        title: 'For your practice',
        text: 'Playlists for your rehearsals, playback that continues with the screen locked, plus a metronome and a tuner (with historical temperaments, if you want to tune beyond equal temperament).',
      },
    ],
  },
  about: {
    title: 'About',
    done: 'Done',
    openLabel: 'About RePitch',
    version: (v) => `Version ${v}`,
    description:
      'RePitch plays your audio files tuned to your instrument. It is made by one person, Matteo Frigé, for musicians who practise with recordings.',
    privacyLine: 'No account, no tracking: your files stay on your device.',
    helpHeader: 'Help improve RePitch',
    suggest: 'Suggest an improvement',
    report: 'Report a problem',
    rate: 'Rate RePitch',
    guideHeader: 'Guide',
    reviewGuide: 'Review the guide',
    dataHeader: 'Your data',
    backupRow: 'Settings backup',
    privacyHeader: 'Privacy',
    privacyPolicy: 'Privacy policy',
    creditsHeader: 'Credits & licences',
    audioEngine: 'Audio engine',
    audioEngineValue: 'Signalsmith Stretch, by Signalsmith Audio (MIT licence)',
    beatDetection: 'Beat detection',
    beatDetectionValue: 'Beat This! — Institute of Computational Perception, JKU Linz (MIT licence)',
    licenseHide: 'Hide the licence',
    licenseShow: 'Show the licence',
    fontsLabel: 'Typefaces',
    fonts: [
      'IM Fell English — Igino Marini',
      'Libre Caslon Text — Pablo Impallari, Rodrigo Fuenzalida',
      'Noto Music — Google',
    ],
    fontsLicense: 'All under the SIL Open Font License 1.1.',
  },
  backup: {
    title: 'Backup',
    done: 'Done',
    intro: pick(
      'Your settings are saved automatically on this iPhone (and included in the iPhone’s iCloud backup, if enabled). Here you can save a copy of them to iCloud Drive or elsewhere, for example to move to a new iPhone. Audio files are not included: after restoring, re-import them and their settings come back by themselves.',
      'Your settings are saved automatically on this phone. Here you can save a copy of them to Google Drive or elsewhere, for example to move to a new phone. Audio files are not included: after restoring, re-import them and their settings come back by themselves.',
    ),
    export: 'Export backup',
    restore: 'Restore from backup',
    shareTitle: 'RePitch backup',
    confirmTitle: 'Restore this backup?',
    confirmMessage:
      'Your A, transposition, track settings and playlists will be replaced with those from the backup.',
    cancel: 'Cancel',
    confirm: 'Restore',
    doneTitle: 'Backup restored',
    report: (matched, pending) =>
      `Restored. ${matched} ${matched === 1 ? 'track matched' : 'tracks matched'}` +
      (pending > 0
        ? `; ${pending} waiting: import ${pending === 1 ? 'that file and its settings will be applied automatically' : 'those files and their settings will be applied automatically'}.`
        : '.'),
    errorTitle: 'Something went wrong',
    errorInvalid: 'This file is not a RePitch backup.',
    errorRead: 'Couldn’t read the file.',
    errorShare: 'Couldn’t share the backup on this device.',
    ok: 'OK',
    pendingTitle: (n) => (n === 1 ? '1 track waiting' : `${n} tracks waiting`),
    pendingBody: 'Import these files and their settings will be applied automatically:',
    andOthers: (n) => `and ${n} more`,
    forget: 'Forget',
    forgetA11y: 'Forget the waiting tracks',
    forgetTitle: 'Forget the waiting tracks?',
    forgetMessage: 'Their settings saved in the backup will no longer be applied when you import them.',
  },
  feedback: {
    suggestionSubject: 'RePitch – suggestion',
    suggestionHint: 'Write your suggestion here.',
    problemSubject: 'RePitch – problem report',
    problemHint: 'What happened? What did you expect?',
    footerApp: 'App',
    footerOs: pick('iOS', 'Android'),
    footerLanguage: 'Language',
    noMailTitle: 'Mail unavailable',
    noMailMessage: (email) => `We can’t open ${pick('the Mail app', 'an email app')}. Write to us at ${email}.`,
    copyAddress: 'Copy address',
    cancel: 'Cancel',
  },
};
