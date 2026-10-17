export type ProgressEvent = { position: number; duration: number };
export type PlayedSecondsEvent = { seconds: number };
export type PlayingChangeEvent = { isPlaying: boolean };

export type MetronomeConfig = {
  /** 20…300 */
  bpm: number;
  /** 1…12 */
  beatsPerBar: number;
  /** 0…1 */
  volume: number;
};
/** `beat` is the position inside the bar (0 = accented first beat). Emitted when the click leaves the speaker. */
export type MetronomeBeatEvent = {
  beat: number;
  accent: boolean;
  /** Epoch ms (same clock as `Date.now()`) at which the click is audible; usually a little in the future. */
  atMs: number;
  /** True for clicks scheduled by the beat follow (reported ~350 ms ahead, already aligned to the track). */
  follow?: boolean;
};
export type TunerReadingEvent = {
  /** Hz, -1 when there is no signal. */
  frequency: number;
  /** 0…1 */
  clarity: number;
  rms: number;
  /** 128 samples normalised to -1…1, for the oscilloscope. */
  wave: number[];
};

export type RepitchAudioEvents = {
  onProgress: (event: ProgressEvent) => void;
  onTrackEnd: () => void;
  onPlayedSeconds: (event: PlayedSecondsEvent) => void;
  onPlayingChange: (event: PlayingChangeEvent) => void;
  onRemoteNext: () => void;
  onRemotePrevious: () => void;
  onMetronomeBeat: (event: MetronomeBeatEvent) => void;
  onTunerReading: (event: TunerReadingEvent) => void;
};

export type TuningDetection = {
  valid: boolean;
  /** Estimated frequency of the track's A, in Hz. */
  refHz: number;
  /** Deviation from 440 Hz in cents. */
  cents: number;
  /** 0…1 */
  confidence: number;
};

export type BeatDetection = {
  valid: boolean;
  /** Valid but low confidence: the user should check by ear. */
  uncertain: boolean;
  /** Median tempo. */
  bpm: number;
  /** 0…1 */
  confidence: number;
  /** Beat positions in seconds, ascending. */
  beats: number[];
  /** 'neural' = Beat This! network (iOS); 'spectral' = spectral-flux tracker (fallback / Android). */
  method: 'neural' | 'spectral';
  /** Index (0…beatsPerBar-1) of the beat that opens the bar; 0 when unknown (spectral). */
  downbeatIndex: number;
  /** 0…1: how clearly the downbeat phase wins over the others; 0 when unknown. */
  downbeatMargin: number;
};

export type DownbeatPhase = { downbeatIndex: number; margin: number };

export type PlayerStatus = {
  position: number;
  duration: number;
  isPlaying: boolean;
  semitones: number;
};
