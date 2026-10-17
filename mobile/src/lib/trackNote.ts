import * as RepitchAudio from '../../modules/repitch-audio';
import { DETECTION_MIN_CONFIDENCE, type Track } from './library';
import { s } from '../i18n';
import { formatHz, formatOverride } from './tuning';

/** Always states what we know about the track's A. */
export function formatTrackLa(track: Track): string {
  if (track.sourceHz != null) return s.trackNote.manual(formatHz(track.sourceHz));
  if (track.detection === 'pending') return s.trackNote.detecting;
  if (track.detection === 'done' && track.detectedHz != null) {
    const hz = formatHz(track.detectedHz);
    return (track.detectedConfidence ?? 0) >= DETECTION_MIN_CONFIDENCE
      ? s.trackNote.detected(hz)
      : s.trackNote.uncertain(hz);
  }
  if (track.detection == null && RepitchAudio.hasDetectTuning()) return s.trackNote.detecting;
  return s.trackNote.notDetected;
}

/** Pencil note for list rows: the track's own tuning (line 1) and its A (line 2). */
export function formatTrackNote(track: Track, separator = '\n'): string {
  const parts: string[] = [];
  if (track.override) parts.push(s.trackNote.ownTuning(formatOverride(track.override)));
  parts.push(formatTrackLa(track));
  return parts.join(separator);
}
