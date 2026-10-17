import { s } from '../i18n';

/** User-facing text for an error from the native module, chosen by its `code`; never the raw native message. */
export function localizedError(e: unknown): string {
  const code = (e as { code?: string } | null)?.code ?? '';
  switch (code) {
    case 'E_LOAD':
      return s.errors.load;
    case 'E_PLAY':
      return s.errors.play;
    case 'E_DETECT':
      return s.errors.detect;
    case 'E_METRONOME':
      return s.errors.metronome;
    case 'E_MIC_DENIED':
      return s.errors.micDenied;
    case 'E_TUNER':
      return s.errors.tuner;
    default:
      return s.errors.unknown;
  }
}
