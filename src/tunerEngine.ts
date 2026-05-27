export type TunerListener = (frequency: number, clarity: number) => void;

/**
 * Autocorrelation pitch detector (Chris Wilson's method). Returns the
 * fundamental frequency in Hz (or -1 if none) and a 0..1 clarity estimate.
 */
function autoCorrelate(buf: Float32Array, sampleRate: number): { freq: number; clarity: number } {
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return { freq: -1, clarity: 0 };

  let r1 = 0;
  let r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < thres) {
      r1 = i;
      break;
    }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < thres) {
      r2 = SIZE - i;
      break;
    }
  }

  const b = buf.slice(r1, r2);
  const newSize = b.length;
  if (newSize < 2) return { freq: -1, clarity: 0 };

  const c = new Array(newSize).fill(0) as number[];
  for (let i = 0; i < newSize; i++) {
    for (let j = 0; j < newSize - i; j++) c[i] += b[j] * b[j + i];
  }

  let d = 0;
  while (d < newSize - 1 && c[d] > c[d + 1]) d++;
  let maxval = -1;
  let maxpos = -1;
  for (let i = d; i < newSize; i++) {
    if (c[i] > maxval) {
      maxval = c[i];
      maxpos = i;
    }
  }
  if (maxpos <= 0) return { freq: -1, clarity: 0 };

  let T0 = maxpos;
  const x1 = c[T0 - 1] ?? 0;
  const x2 = c[T0] ?? 0;
  const x3 = c[T0 + 1] ?? 0;
  const a = (x1 + x3 - 2 * x2) / 2;
  const bb = (x3 - x1) / 2;
  if (a) T0 = T0 - bb / (2 * a);
  if (T0 <= 0) return { freq: -1, clarity: 0 };

  const clarity = Math.max(0, Math.min(1, maxval / (c[0] || 1)));
  return { freq: sampleRate / T0, clarity };
}

export class TunerEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private rafId: number | null = null;
  private buf: Float32Array = new Float32Array(2048);
  private listeners = new Set<TunerListener>();
  // Generation token: invalidates an in-flight start() if stop()/start() is
  // called again during its awaits (React StrictMode double-mount), which would
  // otherwise leave the analyser running on a closed AudioContext.
  private startToken = 0;

  public onReading(listener: TunerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  public async start(deviceId?: string): Promise<void> {
    // Tear down any previous session, then claim a fresh generation token.
    await this.stop();
    const token = this.startToken;

    const ctx = new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId
          ? {
              deviceId: { exact: deviceId },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            }
          : { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
    } catch (err) {
      await ctx.close().catch(() => {});
      throw err;
    }

    // A stop()/start() happened during the awaits → discard this stale session.
    if (token !== this.startToken) {
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close().catch(() => {});
      return;
    }

    this.ctx = ctx;
    this.stream = stream;
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.source.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);

    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      if (!this.analyser || !this.ctx) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      const { freq, clarity } = autoCorrelate(this.buf, this.ctx.sampleRate);
      this.listeners.forEach((l) => l(freq, clarity));
    };
    loop();
  }

  public async stop(): Promise<void> {
    this.startToken++; // invalidate any in-flight start()
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    try {
      this.source?.disconnect();
      this.analyser?.disconnect();
    } catch {
      /* ignore */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        /* ignore */
      }
    }
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
  }
}

export const tunerEngine = new TunerEngine();
