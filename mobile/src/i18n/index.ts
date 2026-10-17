import { getLocales } from 'expo-localization';

import { core as coreEn } from './core.en';
import { core as coreIt } from './core.it';
import { extras as extrasEn } from './extras.en';
import { extras as extrasIt } from './extras.it';

export type Lang = 'it' | 'en';

/**
 * Italian devices get Italian, everything else English. Resolved once at startup: iOS relaunches
 * the app when the system or per-app language changes (Settings › RePitch › Language).
 */
export const lang: Lang = getLocales()[0]?.languageCode === 'it' ? 'it' : 'en';

/** All user-visible strings. Usage: `s.library.title`, `s.tuning.semitones(3)`. */
export const s = lang === 'it' ? { ...coreIt, ...extrasIt } : { ...coreEn, ...extrasEn };
