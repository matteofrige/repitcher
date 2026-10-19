import { NativeModule, requireNativeModule } from 'expo';

import type { BeatDetection, DownbeatPhase, PlayerStatus, TuningDetection, RepitchAudioEvents } from './RepitchAudio.types';

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
  detectBeats?(uri: string, anchors: number[], beatsPerBar: number): Promise<BeatDetection | null>;
  beatDownbeatPhase?(uri: string, beats: number[], beatsPerBar: number): Promise<DownbeatPhase | null>;
  beatTapPosition?(uptimeMs: number): Promise<number | null>;
  beatFollowStart?(beats: number[], beatsPerBar: number, downbeatIndex: number, clickAudible: boolean, volume: number): Promise<void>;
  beatFollowStop?(): Promise<void>;
  beatFollowConfigure?(clickAudible: boolean, beatsPerBar: number, downbeatIndex: number, volume: number): Promise<void>;
  probeAudio?(uri: string): Promise<{ duration: number }>;
}

export default requireNativeModule<RepitchAudioModule>('RepitchAudio');
