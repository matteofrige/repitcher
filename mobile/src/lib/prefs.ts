import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

export type ReviewPrefs = {
  completedTracks: number;
  /** 'YYYY-MM-DD', unique, last 30 kept. */
  activeDays: string[];
  lastPromptAt: number | null;
  lastPromptVersion: string | null;
  lastAnswer: 'happy' | 'unhappy' | null;
};

export type Prefs = {
  onboardingDone: boolean;
  /** Epoch ms of the first launch; anchors the weekly review reminders. */
  firstLaunchAt: number | null;
  review: ReviewPrefs;
};

const PREFS_NAME = 'repitch-prefs.json';

export const DEFAULT_REVIEW: ReviewPrefs = {
  completedTracks: 0,
  activeDays: [],
  lastPromptAt: null,
  lastPromptVersion: null,
  lastAnswer: null,
};

function prefsFile() {
  return new File(Paths.document, PREFS_NAME);
}

function load(): Prefs {
  const defaults: Prefs = { onboardingDone: false, firstLaunchAt: null, review: { ...DEFAULT_REVIEW } };
  try {
    const f = prefsFile();
    if (!f.exists) return defaults;
    const data = JSON.parse(f.textSync());
    // Field by field: a malformed file must never crash the launch (recordActiveDay runs at startup).
    const r = data?.review && typeof data.review === 'object' ? data.review : {};
    return {
      onboardingDone: data?.onboardingDone === true,
      firstLaunchAt: typeof data?.firstLaunchAt === 'number' && Number.isFinite(data.firstLaunchAt) ? data.firstLaunchAt : null,
      review: {
        completedTracks: typeof r.completedTracks === 'number' && Number.isFinite(r.completedTracks) ? r.completedTracks : 0,
        activeDays: Array.isArray(r.activeDays) ? r.activeDays.filter((d: unknown) => typeof d === 'string').slice(-30) : [],
        lastPromptAt: typeof r.lastPromptAt === 'number' ? r.lastPromptAt : null,
        lastPromptVersion: typeof r.lastPromptVersion === 'string' ? r.lastPromptVersion : null,
        lastAnswer: r.lastAnswer === 'happy' || r.lastAnswer === 'unhappy' ? r.lastAnswer : null,
      },
    };
  } catch {
    return defaults;
  }
}

let prefs: Prefs = load();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return prefs;
}

export function updatePrefs(partial: Partial<Omit<Prefs, 'review'>> & { review?: Partial<ReviewPrefs> }) {
  const { review, ...rest } = partial;
  prefs = { ...prefs, ...rest, review: { ...prefs.review, ...(review ?? {}) } };
  try {
    prefsFile().write(JSON.stringify(prefs));
  } catch (e) {
    console.warn('RePitch: saving preferences failed', e);
  }
  listeners.forEach((l) => l());
}

/** True once the user has answered the satisfaction popup (or rated from About). */
export function isReviewSettled(): boolean {
  return prefs.review.lastAnswer !== null;
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getPrefs,
    getPrefs,
  );
}
