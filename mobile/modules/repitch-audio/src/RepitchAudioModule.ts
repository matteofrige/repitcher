import { NativeModule, requireNativeModule } from 'expo';

import type { BeatDetection, PlayerStatus, TuningDetection, RepitchAudioEvents } from './RepitchAudio.types';

declare class RepitchAudioModule extends NativeModule<RepitchAudioEvents> {
  load(uri: string, title?: string | null): Promise<{ duration: number }>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;
  setPitch(semitones: number): Promise<void>;
  getStatus(): Promise<PlayerStatus>;
  metronomeStart(): Promise<void>;
  metronomeStop(): Promise<void>;
  metronomeConfigure(bpm: number, beatsPerBar: number, volume: number): Promise<void>;
  tunerStart(): Promise<void>;
  tunerStop(): Promise<void>;
  toneStart?(frequency: number, volume: number): Promise<void>;
  toneStop?(): Promise<void>;
  detectTuning?(uri: string): Promise<TuningDetection | null>;
  detectBeats?(uri: string): Promise<BeatDetection | null>;
  beatFollowStart?(beats: number[], beatsPerBar: number, clickAudible: boolean, volume: number): Promise<void>;
  beatFollowStop?(): Promise<void>;
  beatFollowConfigure?(clickAudible: boolean, beatsPerBar: number, volume: number): Promise<void>;
  probeAudio?(uri: string): Promise<{ duration: number }>;
}

export default requireNativeModule<RepitchAudioModule>('RepitchAudio');
