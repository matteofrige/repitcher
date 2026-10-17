import { Platform } from 'react-native';

/** Extensions the player decodes (AVAudioFile on iOS, MediaExtractor/ExoPlayer on Android). */
export const SUPPORTED_EXTENSIONS: readonly string[] =
  Platform.OS === 'ios'
    ? ['.mp3', '.m4a', '.aac', '.wav', '.aif', '.aiff', '.aifc', '.caf', '.flac']
    : ['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.oga', '.opus'];

/** Short list for the UI. */
export const SUPPORTED_LABEL =
  Platform.OS === 'ios' ? 'MP3 · M4A · AAC · WAV · AIFF · FLAC' : 'MP3 · M4A · AAC · WAV · FLAC · OGG · OPUS';

export function hasSupportedExtension(name: string): boolean {
  const i = name.lastIndexOf('.');
  if (i < 0) return false;
  return SUPPORTED_EXTENSIONS.includes(name.slice(i).toLowerCase());
}
