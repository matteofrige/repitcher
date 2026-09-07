// Motore del metronomo basato su AudioWorklet.
//
// In precedenza il click veniva generato sul main thread con setInterval +
// lookahead: il jank del main thread (React re-render, GC, IPC...) ritardava
// i battiti in modo udibile. Inoltre l'uscita passava da
// MediaStreamAudioDestinationNode → <audio> element → setSinkId, un percorso
// che ha un jitter buffer con correzione di drift: ricampiona il segnale
// (il tono del click cambia leggermente) e può scartare o duplicare frame
// (il tempo "salta"). Ora il click è generato interamente dentro un
// AudioWorkletProcessor (public/metronome-worklet.js), sample-accurate e
// immune al main thread, e l'uscita usa ctx.setSinkId()/sinkId nel
// costruttore per instradare direttamente sul device fisico, senza passare
// da elementi <audio>.

export type BeatListener = (beat: number, isAccent: boolean) => void;

// TypeScript 4.9 non conosce ancora sinkId/setSinkId su AudioContext, ma
// Chromium ≥110 (quindi Electron 42) li supporta entrambi.
type SinkableContext = AudioContext & {
  setSinkId?: (id: string | { type: 'none' }) => Promise<void>;
};

export class MetronomeEngine {
  private static readonly WORKLET_FILE = 'metronome-worklet.js';

  private ctx: SinkableContext | null = null;
  private workletReady = false;
  private node: AudioWorkletNode | null = null;
  private masterGain: GainNode | null = null;

  private bpm = 100;
  private beatsPerBar = 4;
  private running = false;
  private volume = 0.8;
  private outputDeviceId: string | null = null;

  private listeners = new Set<BeatListener>();

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
    this.sendConfig();
  }

  public setBeatsPerBar(n: number): void {
    this.beatsPerBar = Math.max(1, Math.min(12, Math.round(n)));
    this.sendConfig();
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
   * Pitch Shifter — loopback device / BlackHole would otherwise be silent). */
  public setOutputDevice(deviceId: string | null): void {
    this.outputDeviceId = deviceId;
    this.applySink();
  }

  /** sinkId per la Web Audio API: '' = default di sistema ('default' incluso). */
  private sinkId(): string {
    const id = this.outputDeviceId;
    return id && id !== 'default' ? id : '';
  }

  private applySink(): void {
    const ctx = this.ctx;
    if (!ctx || typeof ctx.setSinkId !== 'function') return;
    ctx.setSinkId(this.sinkId()).catch((err) => {
      console.warn('metronomeEngine: setSinkId failed', err);
    });
  }

  private sendConfig(): void {
    if (this.node) {
      this.node.port.postMessage({ type: 'config', bpm: this.bpm, beatsPerBar: this.beatsPerBar });
    }
  }

  private async ensureWorklet(ctx: AudioContext): Promise<void> {
    if (this.workletReady) return;
    const url = new URL(MetronomeEngine.WORKLET_FILE, document.baseURI).href;
    await ctx.audioWorklet.addModule(url);
    this.workletReady = true;
  }

  private ensureNode(ctx: AudioContext): AudioWorkletNode {
    if (this.node) return this.node;

    const node = new AudioWorkletNode(ctx, 'metronome-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.port.onmessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; beat?: number; accent?: boolean };
      if (data && data.type === 'beat') {
        const beat = data.beat ?? 0;
        const accent = !!data.accent;
        this.listeners.forEach((l) => l(beat, accent));
      }
    };

    const masterGain = ctx.createGain();
    masterGain.gain.value = this.volume;
    node.connect(masterGain);
    masterGain.connect(ctx.destination);

    this.node = node;
    this.masterGain = masterGain;
    return node;
  }

  public async start(): Promise<void> {
    if (this.running) return;

    if (!this.ctx) {
      const sink = this.sinkId();
      const options: AudioContextOptions = {
        latencyHint: 'interactive',
        ...(sink ? { sinkId: sink } : {}),
      } as AudioContextOptions;
      this.ctx = new AudioContext(options) as SinkableContext;
    }
    const ctx = this.ctx;
    if (ctx.state === 'suspended') await ctx.resume();

    await this.ensureWorklet(ctx);
    this.ensureNode(ctx);

    // Se il device di uscita è cambiato dopo la creazione del contesto,
    // applicalo ora.
    this.applySink();

    this.sendConfig();
    this.node!.port.postMessage({ type: 'start' });
    this.running = true;
  }

  public stop(): void {
    if (this.node) this.node.port.postMessage({ type: 'stop' });
    this.running = false;
  }
}

export const metronomeEngine = new MetronomeEngine();
