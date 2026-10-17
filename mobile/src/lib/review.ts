import * as StoreReview from 'expo-store-review';
import { AppState } from 'react-native';

import * as RepitchAudio from '../../modules/repitch-audio';
import { appVersion } from './feedback';
import { DEFAULT_REVIEW, getPrefs, isReviewSettled as settled, updatePrefs } from './prefs';

const MIN_TRACKS = 5;
const MIN_DAYS = 3;
const SHOW_DELAY_MS = 1500;

let initialised = false;
let askedThisSession = false;
let pending = false;
let guideOpen = false;

/** The guide screen tells us when it is on screen: no prompts over it. */
export function setGuideOpen(open: boolean) {
  guideOpen = open;
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function recordActiveDay() {
  const days = getPrefs().review.activeDays;
  const t = today();
  if (days.includes(t)) return;
  updatePrefs({ review: { activeDays: [...days, t].slice(-30) } });
}

export function initReview() {
  if (initialised) return;
  initialised = true;
  recordActiveDay();
  AppState.addEventListener('change', (st) => {
    if (st === 'active') recordActiveDay();
  });
  RepitchAudio.addTrackEndListener(() => {
    updatePrefs({ review: { completedTracks: getPrefs().review.completedTracks + 1 } });
    maybeAskForReview();
  });
}

function eligible(): boolean {
  if (askedThisSession || pending || guideOpen) return false;
  if (AppState.currentState !== 'active') return false;
  // Answered once (any answer, or rated from About): never again.
  if (settled()) return false;
  const r = getPrefs().review;
  if (r.completedTracks < MIN_TRACKS || r.activeDays.length < MIN_DAYS) return false;
  const version = appVersion();
  if (r.lastPromptVersion === version) return false;
  return true;
}

export function maybeAskForReview() {
  if (!eligible()) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    // Re-check: the user may have backgrounded the app or opened the guide in the meantime.
    if (!eligible()) return;
    askedThisSession = true;
    requestSystemReview();
  }, SHOW_DELAY_MS);
}

/**
 * Store rules (Apple 5.6.1, Google Play): no question, incentive or pre-screening before the
 * system review prompt. So we call it directly and consider the matter settled, whatever the
 * outcome (the OS decides whether to actually show the dialog and applies its own quota).
 */
function requestSystemReview() {
  markRated();
  void (async () => {
    try {
      if (await StoreReview.isAvailableAsync()) await StoreReview.requestReview();
    } catch {}
  })();
}

export { isReviewSettled } from './prefs';

/** The prompt was shown, or the user rated from the About page: never ask again. */
export function markRated() {
  updatePrefs({ review: { lastPromptAt: Date.now(), lastPromptVersion: appVersion(), lastAnswer: 'happy' } });
}

/** Dev only: forget everything the rating prompt knows. */
export function __debugResetReview() {
  updatePrefs({ review: { ...DEFAULT_REVIEW, activeDays: [] } });
  askedThisSession = false;
  pending = false;
}
