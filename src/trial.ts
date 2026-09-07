// ════════════════════════════════════════════════════════════════════════
//  BLOCCO TRIAL TEMPORANEO — RIMUOVERE quando arriva la licenza con serial.
//  Per rimuoverlo completamente:
//    1) elimina questo file (src/trial.ts) e src/components/TrialLock.tsx
//       + src/styles/TrialLock.css;
//    2) in src/App.tsx togli gli import di trial/TrialLock e il blocco
//       delimitato dai commenti "TRIAL START / TRIAL END";
//    3) in src/components/Settings.tsx togli l'import di trial e la
//       <section> "License".
//  La build smette di funzionare TRIAL_DURATION_DAYS giorni dopo TRIAL_RELEASE_DATE.
// ════════════════════════════════════════════════════════════════════════

const DAY_MS = 24 * 60 * 60 * 1000;

/** Data di rilascio di questa versione (build). */
export const TRIAL_RELEASE_DATE = new Date('2026-09-07T12:00:00');
export const TRIAL_DURATION_DAYS = 60;
export const TRIAL_EXPIRY = new Date(TRIAL_RELEASE_DATE.getTime() + TRIAL_DURATION_DAYS * DAY_MS);

/** Giorni interi rimanenti prima del blocco (0 se scaduto). */
export function trialDaysLeft(now: Date = new Date()): number {
  return Math.max(0, Math.ceil((TRIAL_EXPIRY.getTime() - now.getTime()) / DAY_MS));
}

/** true quando il periodo di prova è terminato. */
export function isTrialExpired(now: Date = new Date()): boolean {
  return now.getTime() >= TRIAL_EXPIRY.getTime();
}
