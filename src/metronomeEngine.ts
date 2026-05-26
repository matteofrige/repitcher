export type BeatListener = (beat: number, isAccent: boolean) => void;

export class MetronomeEngine {
  private ctx: AudioContext | null = null;
  private bpm = 100;
  private beatsPerBar = 4;
  private running = false;
  private currentBeat = 0;
  private nextNoteTime = 0;
  private timer: number | null = null;
  private readonly lookahead = 25; // ms
  private readonly scheduleAhead = 0.1; // s
  private listeners = new Set<BeatListener>();

  // Output routing — the click must be audible even when the system default
  // output is a loopback device (BlackHole). When an output device id is set we
  // play through an <audio> element + setSinkId to that physical device.
  private masterGain: GainNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private outputEl: HTMLAudioElement | null = null;
  private outputDeviceId: string | null = null;
  private volume = 0.8;

  public onBeat(listener: BeatListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public isRunning(): boolean {
    return this.running;
  }
  public getBpm(): number {
    return this.bpm;
  }
  public getBeatsPerBar(): number {
    return this.beatsPerBar;
  }
  public setBpm(n: number): void {
    if (!Number.isFinite(n)) return;
    this.bpm = Math.max(20, Math.min(300, Math.round(n)));
  }
  public setBeatsPerBar(n: number): void {
    this.beatsPerBar = Math.max(1, Math.min(12, Math.round(n)));
    if (this.currentBeat >= this.beatsPerBar) this.currentBeat = 0;
  }

  public getVolume(): number {
    return this.volume;
  }
  /** Click volume, 0..1. */
  public setVolume(v: number): void {
    if (!Number.isFinite(v)) return;
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) this.masterGain.gain.value = this.volume;
  }

  /** Physical output device for the click (e.g. the speakers picked in the
   * Pitch Shifter). Pass null to use the system default output. */
  public setOutputDevice(deviceId: string | null): void {
    this.outputDeviceId = deviceId;
    if (this.ctx) this.ensureRouting();
  }

  private ensureRouting(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.masterGain) {
      this.masterGain = ctx.createGain();
    }
    this.masterGain.gain.value = this.volume;
    try {
      this.masterGain.disconnect();
    } catch {
      /* ignore */
    }
    if (this.outputDeviceId) {
      if (!this.streamDest) this.streamDest = ctx.createMediaStreamDestination();
      this.masterGain.connect(this.streamDest);
      if (!this.outputEl) {
        this.outputEl = new Audio();
        this.outputEl.autoplay = true;
      }
      this.outputEl.srcObject = this.streamDest.stream;
      const sinkable = this.outputEl as HTMLAudioElement & {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (typeof sinkable.setSinkId === 'function') {
        sinkable.setSinkId(this.outputDeviceId).catch(() => {
          /* ignore */
        });
      }
      this.outputEl.play().catch(() => {
        /* ignore */
      });
    } else {
      this.masterGain.connect(ctx.destination);
    }
  }

  public async start(): Promise<void> {
    if (this.running) return;
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.ensureRouting();
    this.running = true;
    this.currentBeat = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.timer = window.setInterval(() => this.scheduler(), this.lookahead);
  }

  public stop(): void {
    this.running = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private scheduler(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.nextNoteTime < ctx.currentTime + this.scheduleAhead) {
      const beat = this.currentBeat;
      const isAccent = beat === 0;
      this.scheduleClick(this.nextNoteTime, isAccent);
      const delayMs = Math.max(0, (this.nextNoteTime - ctx.currentTime) * 1000);
      window.setTimeout(() => this.listeners.forEach((l) => l(beat, isAccent)), delayMs);
      this.nextNoteTime += 60 / this.bpm;
      this.currentBeat = (this.currentBeat + 1) % this.beatsPerBar;
    }
  }

  private scheduleClick(time: number, accent: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // Downbeat accent is higher-pitched (and louder) so it's clearly audible
    // against the regular beats.
    osc.frequency.value = accent ? 1600 : 950;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.8 : 0.5, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.06);
  }
}

export const metronomeEngine = new MetronomeEngine();
