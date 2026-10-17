import type { EventSubscription } from 'expo-modules-core';

import type {
  BeatDetection,
  MetronomeBeatEvent,
  MetronomeConfig,
  PlayedSecondsEvent,
  PlayerStatus,
  PlayingChangeEvent,
  ProgressEvent,
  TunerReadingEvent,
  TuningDetection,
} from './src/RepitchAudio.types';
import RepitchAudioModule from './src/RepitchAudioModule';

export type {
  BeatDetection,
  MetronomeBeatEvent,
  MetronomeConfig,
  PlayedSecondsEvent,
  PlayerStatus,
  PlayingChangeEvent,
  ProgressEvent,
  TunerReadingEvent,
  TuningDetection,
};

export const MAX_TOTAL_SEMITONES = 24;

export function load(uri: string, title?: string): Promise<{ duration: number }> {
  return RepitchAudioModule.load(uri, title ?? null);
}
export function play(): Promise<void> {
  return RepitchAudioModule.play();
}
export function pause(): Promise<void> {
  return RepitchAudioModule.pause();
}
export function seek(seconds: number): Promise<void> {
  return RepitchAudioModule.seek(seconds);
}
/** Clamped to ±MAX_TOTAL_SEMITONES; a non-finite value (bad stored tuning) becomes 0 rather than reaching the DSP. */
export function setPitch(semitones: number): Promise<void> {
  const v = Number.isFinite(semitones) ? Math.max(-MAX_TOTAL_SEMITONES, Math.min(MAX_TOTAL_SEMITONES, semitones)) : 0;
  return RepitchAudioModule.setPitch(v);
}
export function getStatus(): Promise<PlayerStatus> {
  return RepitchAudioModule.getStatus();
}

export function addProgressListener(cb: (e: ProgressEvent) => void): EventSubscription {
  return RepitchAudioModule.addListener('onProgress', cb);
}
export function addTrackEndListener(cb: () => void): EventSubscription {
  return RepitchAudioModule.addListener('onTrackEnd', cb);
}
export function addPlayedSecondsListener(cb: (e: PlayedSecondsEvent) => void): EventSubscription {
  return RepitchAudioModule.addListener('onPlayedSeconds', cb);
}
export function addPlayingChangeListener(cb: (e: PlayingChangeEvent) => void): EventSubscription {
  return RepitchAudioModule.addListener('onPlayingChange', cb);
}
export function addRemoteNextListener(cb: () => void): EventSubscription {
  return RepitchAudioModule.addListener('onRemoteNext', cb);
}
export function addRemotePreviousListener(cb: () => void): EventSubscription {
  return RepitchAudioModule.addListener('onRemotePrevious', cb);
}

// --- Metronome (native, sample-accurate; plays over the track) ---

export function metronomeStart(): Promise<void> {
  return RepitchAudioModule.metronomeStart();
}
export function metronomeStop(): Promise<void> {
  return RepitchAudioModule.metronomeStop();
}
/** Also valid while running. */
export function metronomeConfigure(cfg: MetronomeConfig): Promise<void> {
  return RepitchAudioModule.metronomeConfigure(cfg.bpm, cfg.beatsPerBar, cfg.volume);
}
export function addMetronomeBeatListener(cb: (e: MetronomeBeatEvent) => void): EventSubscription {
  return RepitchAudioModule.addListener('onMetronomeBeat', cb);
}

// --- Beat follow (metronome on the track's own beats) ---

/** False where the native side has no beat tracker (older binary, Android for now). */
export function beatFollowAvailable(): boolean {
  return typeof RepitchAudioModule.detectBeats === 'function' && typeof RepitchAudioModule.beatFollowStart === 'function';
}
/** Finds the beats of a whole file in the background (can take several seconds). */
export function detectBeats(uri: string, anchors: number[] = []): Promise<BeatDetection | null> {
  if (!RepitchAudioModule.detectBeats) return Promise.resolve(null);
  return RepitchAudioModule.detectBeats(uri, anchors);
}
/**
 * Track position (seconds) audible at the moment of a touch. `uptimeMs` is RN's `nativeEvent.timestamp`
 * (iOS: system uptime in ms, same clock as the audio host time); output + pitch latency already subtracted.
 * Null when the track isn't playing or the platform has no support.
 */
export function beatTapPosition(uptimeMs: number): Promise<number | null> {
  if (!RepitchAudioModule.beatTapPosition) return Promise.resolve(null);
  return RepitchAudioModule.beatTapPosition(uptimeMs);
}
/** Clicks/flashes on `beats` (seconds in the loaded track) while it plays; replaces the fixed-tempo metronome. */
export function beatFollowStart(beats: number[], beatsPerBar: number, downbeatIndex: number, clickAudible: boolean, volume: number): Promise<void> {
  if (!RepitchAudioModule.beatFollowStart) return Promise.resolve();
  return RepitchAudioModule.beatFollowStart(beats, beatsPerBar, downbeatIndex, clickAudible, volume);
}
export function beatFollowStop(): Promise<void> {
  if (!RepitchAudioModule.beatFollowStop) return Promise.resolve();
  return RepitchAudioModule.beatFollowStop();
}
export function beatFollowConfigure(clickAudible: boolean, beatsPerBar: number, downbeatIndex: number, volume: number): Promise<void> {
  if (!RepitchAudioModule.beatFollowConfigure) return Promise.resolve();
  return RepitchAudioModule.beatFollowConfigure(clickAudible, beatsPerBar, downbeatIndex, volume);
}

// --- Tuner (microphone) ---

/** Asks for the microphone permission if needed; rejects with code 'E_MIC_DENIED' when denied. */
export function tunerStart(): Promise<void> {
  return RepitchAudioModule.tunerStart();
}
export function tunerStop(): Promise<void> {
  return RepitchAudioModule.tunerStop();
}
export function addTunerReadingListener(cb: (e: TunerReadingEvent) => void): EventSubscription {
  return RepitchAudioModule.addListener('onTunerReading', cb);
}

// --- Reference tone (tuner) ---

/** False on a binary built before the reference tone existed. */
export function hasTone(): boolean {
  return typeof RepitchAudioModule.toneStart === 'function';
}
/** Starts a sustained tone, or glides to the new frequency if one is already sounding. */
export function toneStart(frequency: number, volume = 1): Promise<void> {
  if (!RepitchAudioModule.toneStart) return Promise.resolve();
  return RepitchAudioModule.toneStart(frequency, volume);
}
export function toneStop(): Promise<void> {
  if (!RepitchAudioModule.toneStop) return Promise.resolve();
  return RepitchAudioModule.toneStop();
}

/** False on a binary built before the detector existed. */
export function hasDetectTuning(): boolean {
  return typeof RepitchAudioModule.detectTuning === 'function';
}
/** Estimates the A tuning of a file (3 windows of ≤25 s, mono) in the background. */
export function detectTuning(uri: string): Promise<TuningDetection | null> {
  if (!RepitchAudioModule.detectTuning) return Promise.resolve(null);
  return RepitchAudioModule.detectTuning(uri);
}

/** False on a binary built before the import probe existed. */
export function hasProbeAudio(): boolean {
  return typeof RepitchAudioModule.probeAudio === 'function';
}
/** Opens the file with the platform decoder; rejects with code 'E_UNSUPPORTED' if it can't be played. */
export function probeAudio(uri: string): Promise<{ duration: number }> {
  if (!RepitchAudioModule.probeAudio) return Promise.reject(Object.assign(new Error('probeAudio unavailable'), { code: 'E_UNAVAILABLE' }));
  return RepitchAudioModule.probeAudio(uri);
}
