// Signalsmith Stretch (WASM) pitch-shifter worklet.
// Built from wasm/ into public/signalsmith-worklet.js (see wasm/README.md).
const STRETCH_WORKLET_FILE = 'signalsmith-worklet.js';
const STRETCH_PROCESSOR_NAME = 'signalsmith-stretch-processor';

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

export interface EngineStatus {
  running: boolean;
  bypassed: boolean;
  inputDeviceId: string | null;
  inputDeviceLabel: string | null;
  outputDeviceId: string | null;
  outputDeviceLabel: string | null;
  pitchSemitones: number;
  detuneCents: number;
  sampleRate: number;
  latencyMs: number;
  contextState: AudioContextState;
}

export type StatusListener = (status: EngineStatus) => void;

/**
 * Signal-name match for loopback capture devices across platforms:
 *   macOS    -> BlackHole / Soundflower
 *   Windows  -> VB-Audio Virtual Cable, "Stereo Mix"
 *   Linux    -> PulseAudio / PipeWire "Monitor" sources
 */
const LOOPBACK_PATTERNS = [
  /blackhole/i,
  /soundflower/i,
  /loopback/i,
  /vb-?audio/i,
  /cable output/i,
  /stereo mix/i,
  /monitor/i,
];

export function looksLikeLoopbackDevice(label: string): boolean {
  return LOOPBACK_PATTERNS.some((pattern) => pattern.test(label));
}

/**
 * Real-time pitch-shifting engine.
 *
 * Signal path:
 *   getUserMedia(loopback device)  ->  MediaStreamSource
 *     ->  Signalsmith Stretch WASM AudioWorklet (semitones, no tempo change)
 *     ->  AnalyserNode (visualiser tap)
 *     ->  <audio> element + setSinkId (processed output to a PHYSICAL device)
 *
 * The user routes system audio into a loopback device (BlackHole on macOS,
 * VB-Cable on Windows, a Monitor source on Linux) and sets it as the system
 * output. We capture from it, pitch-shift, and play the result to the physical
 * speakers/headphones via setSinkId. Input and output are different devices, so
 * there is no feedback loop.
 */
export class AudioEngine {
  private permissionPrimed = false;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private pitchNode: AudioWorkletNode | null = null;
  private workletReady = false;
  private analyser: AnalyserNode | null = null;
  private bypassGain: GainNode | null = null;
  private processedGain: GainNode | null = null;
  private outputGain: GainNode | null = null;
  private streamDestination: MediaStreamAudioDestinationNode | null = null;
  private outputEl: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;
  private preferredOutputId: string | null = null;
  private status: EngineStatus = {
    running: false,
    bypassed: false,
    inputDeviceId: null,
    inputDeviceLabel: null,
    outputDeviceId: null,
    outputDeviceLabel: null,
    pitchSemitones: 0,
    detuneCents: 0,
    sampleRate: 0,
    latencyMs: 0,
    contextState: 'suspended',
  };

  private listeners = new Set<StatusListener>();

  public onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  public getStatus(): EngineStatus {
    return { ...this.status };
  }

  private emit(): void {
    const snapshot = { ...this.status };
    this.listeners.forEach((listener) => listener(snapshot));
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /**
   * Trigger the getUserMedia permission prompt exactly once so enumerateDevices
   * returns populated device labels. (Repeated probes race on macOS.)
   */
  private async primePermission(): Promise<void> {
    if (this.permissionPrimed) return;
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
      this.permissionPrimed = true;
    } catch (err) {
      console.warn('Probe getUserMedia failed; device labels may be hidden.', err);
    }
  }

  public async listInputDevices(): Promise<AudioDevice[]> {
    await this.primePermission();
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Unknown input', kind: d.kind }));
  }

  public async listOutputDevices(): Promise<AudioDevice[]> {
    await this.primePermission();
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'audiooutput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Unknown output', kind: d.kind }));
  }

  /** Auto-detect a loopback capture device (BlackHole / VB-Cable / Monitor). */
  public async findLoopbackDevice(): Promise<AudioDevice | null> {
    const devices = await this.listInputDevices();
    return devices.find((d) => looksLikeLoopbackDevice(d.label)) ?? null;
  }

  /**
   * Pick a PHYSICAL output device (speakers/headphones), excluding loopback
   * devices — routing the processed output back into the loopback would create
   * a feedback loop.
   */
  public async findPhysicalOutputDevice(): Promise<AudioDevice | null> {
    const outs = await this.listOutputDevices();
    const nonLoopback = outs.filter((d) => !looksLikeLoopbackDevice(d.label));
    return (
      nonLoopback.find((d) => d.deviceId !== 'default' && d.deviceId !== 'communications') ??
      nonLoopback[0] ??
      null
    );
  }

  /**
   * Acquire the input stream from the loopback device. If no deviceId is given,
   * auto-detect one. No built-in DSP (echo/AGC/NS) so music is untouched.
   */
  private async acquireInputStream(
    deviceId: string | undefined
  ): Promise<{ stream: MediaStream; label: string; deviceId: string | null }> {
    let inputId = deviceId;
    let inputLabel = 'Selected input';
    if (!inputId) {
      const auto = await this.findLoopbackDevice();
      if (!auto) {
        throw new Error(
          'No loopback device found. Install BlackHole (macOS) or VB-Cable (Windows), ' +
            'or use a Monitor source (Linux), then set it as the system output.'
        );
      }
      inputId = auto.deviceId;
      inputLabel = auto.label;
    } else {
      const devices = await this.listInputDevices();
      const match = devices.find((d) => d.deviceId === inputId);
      if (match) inputLabel = match.label;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: inputId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
      },
      video: false,
    });
    return { stream, label: inputLabel, deviceId: inputId };
  }

  /** Lazily create the single native AudioContext used by the engine. */
  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this.audioContext;
  }

  /**
   * Load the Signalsmith Stretch AudioWorklet module once per context. The
   * worklet file lives in public/ so it is reachable from the CRA dev server
   * and the packaged file:// build.
   */
  private async ensureWorklet(ctx: AudioContext): Promise<void> {
    if (this.workletReady) return;
    const url = new URL(STRETCH_WORKLET_FILE, document.baseURI).href;
    await ctx.audioWorklet.addModule(url);
    this.workletReady = true;
  }

  public async start(deviceId?: string): Promise<void> {
    if (this.status.running) {
      await this.stop();
    }

    // Lazily create/resume the native audio context (user-gesture required).
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    this.status.sampleRate = ctx.sampleRate;
    this.status.contextState = ctx.state;

    await this.ensureWorklet(ctx);

    // Choose the physical output device BEFORE capturing (so device labels are
    // primed once) — the processed audio plays here, not into the loopback.
    let outId = this.preferredOutputId ?? undefined;
    let outLabel: string | null = null;
    if (outId) {
      const outs = await this.listOutputDevices();
      outLabel = outs.find((d) => d.deviceId === outId)?.label ?? null;
    } else {
      const physical = await this.findPhysicalOutputDevice();
      outId = physical?.deviceId;
      outLabel = physical?.label ?? null;
    }

    // Acquire the loopback input stream.
    const acquired = await this.acquireInputStream(deviceId);
    const stream = acquired.stream;
    const inputId = acquired.deviceId;
    const inputLabel = acquired.label;

    this.mediaStream = stream;
    const source = ctx.createMediaStreamSource(stream);
    this.sourceNode = source;

    // Signalsmith Stretch pitch-shift node (high-quality, WASM).
    const pitchNode = new AudioWorkletNode(ctx, STRETCH_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    this.pitchNode = pitchNode;
    const semitonesParam = pitchNode.parameters.get('semitones');
    if (semitonesParam) {
      semitonesParam.value = this.effectivePitch();
    }
    pitchNode.port.onmessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; samples?: number };
      if (data?.type === 'latency' && typeof data.samples === 'number') {
        const sr = this.audioContext?.sampleRate ?? 48000;
        this.status.latencyMs = Math.round((data.samples / sr) * 1000);
        this.emit();
      }
    };

    // Wet/dry crossfade for bypass.
    const bypassGain = ctx.createGain();
    bypassGain.gain.value = this.status.bypassed ? 1 : 0;
    const processedGain = ctx.createGain();
    processedGain.gain.value = this.status.bypassed ? 0 : 1;
    this.bypassGain = bypassGain;
    this.processedGain = processedGain;

    const outputGain = ctx.createGain();
    outputGain.gain.value = 1;
    this.outputGain = outputGain;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.9;
    this.analyser = analyser;

    // Wire it up.
    //  source --> bypass ------------> outputGain --> (physical output)
    //         \-> pitchNode --> processedGain --> outputGain
    //                                         \-> analyser (tap)
    source.connect(bypassGain);
    bypassGain.connect(outputGain);
    source.connect(pitchNode);
    pitchNode.connect(processedGain);
    processedGain.connect(outputGain);
    processedGain.connect(analyser);

    // Route the processed/bypassed output to a PHYSICAL device via an <audio>
    // element + setSinkId (NOT ctx.destination, which is the loopback device).
    await this.routeToOutputDevice(ctx, outId, outLabel);

    const baseLatency = (ctx as AudioContext & { baseLatency?: number }).baseLatency ?? 0;
    const outputLatency =
      (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    this.status.latencyMs = Math.round((baseLatency + outputLatency) * 1000);

    this.status.running = true;
    this.status.inputDeviceId = inputId;
    this.status.inputDeviceLabel = inputLabel;
    this.status.contextState = ctx.state;
    this.emit();
  }

  /**
   * Route the master output to a specific physical device using an <audio>
   * element + HTMLMediaElement.setSinkId, instead of the AudioContext default
   * output (which is the loopback device the user captures from).
   */
  private async routeToOutputDevice(
    ctx: AudioContext,
    deviceId: string | undefined,
    label: string | null
  ): Promise<void> {
    if (!this.outputGain) return;

    if (!this.streamDestination) {
      this.streamDestination = ctx.createMediaStreamDestination();
      this.outputGain.connect(this.streamDestination);
    }
    if (!this.outputEl) {
      const el = new Audio();
      el.autoplay = true;
      el.srcObject = this.streamDestination.stream;
      this.outputEl = el;
    }

    const sinkable = this.outputEl as HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (deviceId && typeof sinkable.setSinkId === 'function') {
      try {
        await sinkable.setSinkId(deviceId);
        this.status.outputDeviceId = deviceId;
        this.status.outputDeviceLabel = label;
      } catch (err) {
        console.warn('setSinkId failed; using default output device.', err);
      }
    }

    try {
      await this.outputEl.play();
    } catch (err) {
      console.warn('Output <audio> play() was blocked:', err);
    }
  }

  /**
   * Switch the processed-audio output to a specific physical device at runtime
   * (used by the output-device selector in the UI).
   */
  public async setOutputDevice(deviceId: string): Promise<void> {
    this.preferredOutputId = deviceId;
    const outs = await this.listOutputDevices();
    const label = outs.find((d) => d.deviceId === deviceId)?.label ?? null;
    const sinkable = this.outputEl as
      | (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> })
      | null;
    if (sinkable && typeof sinkable.setSinkId === 'function') {
      await sinkable.setSinkId(deviceId);
    }
    this.status.outputDeviceId = deviceId;
    this.status.outputDeviceLabel = label;
    this.emit();
  }

  public async stop(): Promise<void> {
    if (!this.status.running && !this.mediaStream) {
      return;
    }

    try {
      this.sourceNode?.disconnect();
    } catch {
      // ignore
    }
    try {
      this.pitchNode?.disconnect();
    } catch {
      // ignore
    }
    try {
      this.bypassGain?.disconnect();
      this.processedGain?.disconnect();
      this.outputGain?.disconnect();
      this.analyser?.disconnect();
    } catch {
      // ignore
    }
    try {
      this.streamDestination?.disconnect();
    } catch {
      // ignore
    }
    if (this.outputEl) {
      this.outputEl.pause();
      this.outputEl.srcObject = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
    }

    this.sourceNode = null;
    this.pitchNode = null;
    this.bypassGain = null;
    this.processedGain = null;
    this.outputGain = null;
    this.analyser = null;
    this.streamDestination = null;
    this.outputEl = null;
    this.mediaStream = null;

    this.status.running = false;
    this.status.inputDeviceId = null;
    this.status.inputDeviceLabel = null;
    this.emit();
  }

  /**
   * Effective pitch in semitones = coarse semitone offset + a relative fine
   * detune in cents (hundredths of a semitone). The detune is relative (centred
   * on 0), not tied to any absolute reference frequency — the source audio is
   * arbitrary, so an absolute "A = x Hz" is meaningless here.
   */
  private effectivePitch(): number {
    return this.status.pitchSemitones + this.status.detuneCents / 100;
  }

  private applyPitch(): void {
    if (this.pitchNode) {
      const param = this.pitchNode.parameters.get('semitones');
      if (param) param.value = this.effectivePitch();
    }
  }

  public setPitchSemitones(semitones: number): void {
    const clamped = Math.max(-6, Math.min(6, semitones));
    this.status.pitchSemitones = clamped;
    this.applyPitch();
    this.emit();
  }

  /**
   * Relative fine detune in cents (-100..+100 = ±1 semitone), combined with the
   * semitone setting. 0 = no fine adjustment.
   */
  public setDetuneCents(cents: number): void {
    if (!Number.isFinite(cents)) return;
    this.status.detuneCents = Math.max(-100, Math.min(100, Math.round(cents)));
    this.applyPitch();
    this.emit();
  }

  /**
   * Bypass crossfades between dry input and pitched output. Smoother than
   * disconnecting nodes, and avoids clicks when toggled mid-program.
   */
  public setBypassed(bypassed: boolean): void {
    this.status.bypassed = bypassed;
    if (this.bypassGain && this.processedGain && this.audioContext) {
      const now = this.audioContext.currentTime;
      const fade = 0.03; // 30 ms equal-power-ish crossfade
      this.bypassGain.gain.cancelScheduledValues(now);
      this.processedGain.gain.cancelScheduledValues(now);
      this.bypassGain.gain.setTargetAtTime(bypassed ? 1 : 0, now, fade);
      this.processedGain.gain.setTargetAtTime(bypassed ? 0 : 1, now, fade);
    }
    this.emit();
  }
}

export const audioEngine = new AudioEngine();
