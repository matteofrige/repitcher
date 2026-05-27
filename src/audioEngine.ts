// Signalsmith Stretch (WASM) pitch-shifter worklet.
// Built from wasm/ into public/signalsmith-worklet.js (see wasm/README.md).
const STRETCH_WORKLET_FILE = 'signalsmith-worklet.js';
const STRETCH_PROCESSOR_NAME = 'signalsmith-stretch-processor';

// PCM player worklet for macOS native audio capture via audiotee.
const PCM_PLAYER_WORKLET_FILE = 'pcm-player.js';
const PCM_PLAYER_PROCESSOR_NAME = 'pcm-player';

// Ring buffer constants (48 kHz stereo, 2-second capacity, 50 ms pre-roll).
const PCM_SR = 48000;
const PCM_CHANNELS = 2;
const PCM_CAPACITY = PCM_SR * PCM_CHANNELS * 2; // interleaved float32 samples
const PCM_PREROLL = Math.round(PCM_SR * 0.05);   // pre-roll frames

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
 *   capture source  ->  Signalsmith Stretch WASM AudioWorklet (semitones)
 *     ->  AnalyserNode (visualiser tap)
 *     ->  <audio> element + setSinkId (processed output to a PHYSICAL device)
 *
 * The capture source depends on the platform:
 *   - macOS: the native `audiotee` binary taps system audio (Core Audio process
 *     tap), muting the original and excluding our own audio process to avoid a
 *     feedback loop. PCM is streamed over IPC into a ring buffer that feeds the
 *     `pcm-player` AudioWorklet. No virtual device needed.
 *   - Windows/Linux: a loopback device (VB-Cable / Monitor source) captured via
 *     getUserMedia.
 * The processed result always plays to a physical device via setSinkId.
 */
export class AudioEngine {
  private permissionPrimed = false;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private pitchNode: AudioWorkletNode | null = null;
  private workletReady = false;
  private pcmWorkletReady = false;
  private analyser: AnalyserNode | null = null;
  private bypassGain: GainNode | null = null;
  private processedGain: GainNode | null = null;
  private outputGain: GainNode | null = null;
  private streamDestination: MediaStreamAudioDestinationNode | null = null;
  private outputEl: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;
  private preferredOutputId: string | null = null;

  // macOS native capture (audiotee + ring buffer)
  private ringSAB: SharedArrayBuffer | null = null;
  private controlSAB: SharedArrayBuffer | null = null;
  private ring: Float32Array | null = null;
  private control: Int32Array | null = null;
  private pcmUnsub: (() => void) | null = null;
  private pcmPlayerNode: AudioWorkletNode | null = null;

  // Guard against concurrent/duplicate start() calls (React StrictMode double
  // mount, immediate + gesture auto-start) which would spawn two audiotee
  // processes and two pipelines → distortion.
  private starting = false;

  private isMac(): boolean {
    return (window as unknown as { repitch?: { platform?: string } }).repitch?.platform === 'darwin';
  }
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
      // On macOS the native audiotee capture emits PCM at PCM_SR (48 kHz), so the
      // context must run at the same rate or the worklet would play it back at the
      // wrong speed/pitch. Output is resampled to the physical device downstream.
      this.audioContext = this.isMac()
        ? new AudioContext({ sampleRate: PCM_SR })
        : new AudioContext();
    }
    return this.audioContext;
  }

  /**
   * Load the Signalsmith Stretch AudioWorklet module once per context. The
   * worklet file lives in public/ so it is reachable from the CRA dev server
   * and the packaged file:// build.
   */
  private async ensureWorklet(ctx: AudioContext): Promise<void> {
    if (!this.workletReady) {
      const url = new URL(STRETCH_WORKLET_FILE, document.baseURI).href;
      await ctx.audioWorklet.addModule(url);
      this.workletReady = true;
    }
    if (this.isMac() && !this.pcmWorkletReady) {
      const url = new URL(PCM_PLAYER_WORKLET_FILE, document.baseURI).href;
      await ctx.audioWorklet.addModule(url);
      this.pcmWorkletReady = true;
    }
  }

  /** Public entry point — gated so concurrent/duplicate calls are ignored. */
  public async start(deviceId?: string): Promise<void> {
    if (this.starting || this.status.running) return;
    this.starting = true;
    try {
      await this._start(deviceId);
    } finally {
      this.starting = false;
    }
  }

  private async _start(deviceId?: string): Promise<void> {
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

    // Acquire the input source — native audiotee on macOS, getUserMedia elsewhere.
    let source: AudioNode;
    let inputId: string | null;
    let inputLabel: string;

    if (this.isMac()) {
      // Allocate ring buffer SABs once (reuse across restarts)
      if (!this.ringSAB) {
        this.ringSAB = new SharedArrayBuffer(PCM_CAPACITY * 4);
        this.controlSAB = new SharedArrayBuffer(3 * 4);
      }
      this.ring = new Float32Array(this.ringSAB);
      this.control = new Int32Array(this.controlSAB!);
      // Reset control indices
      this.control[0] = 0; this.control[1] = 0; this.control[2] = 0;

      const pcmPlayer = new AudioWorkletNode(ctx, PCM_PLAYER_PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          ringSAB: this.ringSAB,
          controlSAB: this.controlSAB,
          capacity: PCM_CAPACITY,
          prerollFrames: PCM_PREROLL,
        },
      });
      this.pcmPlayerNode = pcmPlayer;
      source = pcmPlayer;
      inputLabel = 'System Audio';
      inputId = null;

      // Register PCM chunk producer
      const repitch = (window as unknown as { repitch?: { onPcm?: (cb: (chunk: Uint8Array) => void) => () => void } }).repitch;
      if (repitch?.onPcm) {
        this.pcmUnsub = repitch.onPcm((chunk) => this.writePcm(chunk));
      }
    } else {
      // Win/Linux: acquire getUserMedia loopback stream as before
      const acquired = await this.acquireInputStream(deviceId);
      const stream = acquired.stream;
      inputId = acquired.deviceId;
      inputLabel = acquired.label;
      this.mediaStream = stream;
      const msSource = ctx.createMediaStreamSource(stream);
      this.sourceNode = msSource;
      source = msSource;
    }

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

    // On macOS: start audiotee AFTER routeToOutputDevice so the Chromium Audio
    // Service process is already alive and its PID can be found for exclusion.
    if (this.isMac()) {
      const repitch = (window as unknown as { repitch?: { startCapture?: () => Promise<{ ok: boolean; pid?: number | null; error?: string }> } }).repitch;
      if (repitch?.startCapture) {
        try {
          await repitch.startCapture();
        } catch (err) {
          console.error('[audioEngine] startCapture failed:', err);
        }
      }
    }

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

  /**
   * PCM producer: write a Float32 LE stereo interleaved chunk into the ring buffer.
   * Called from the IPC onPcm listener on macOS.
   */
  private writePcm(chunk: Uint8Array): void {
    if (!this.ring || !this.control) return;
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const sampleCount = Math.floor(chunk.byteLength / 4);
    if (sampleCount === 0) return;

    const w = Atomics.load(this.control, 0);
    const r = Atomics.load(this.control, 1);
    const free = PCM_CAPACITY - (w - r);
    const toWrite = Math.min(sampleCount, Math.max(0, free));

    for (let j = 0; j < toWrite; j++) {
      this.ring[(w + j) % PCM_CAPACITY] = view.getFloat32(j * 4, true);
    }
    Atomics.store(this.control, 0, w + toWrite);
  }

  public async stop(): Promise<void> {
    if (!this.status.running && !this.mediaStream) {
      return;
    }

    // macOS: stop native capture and unsubscribe PCM listener
    if (this.isMac()) {
      this.pcmUnsub?.();
      this.pcmUnsub = null;
      const repitch = (window as unknown as { repitch?: { stopCapture?: () => Promise<boolean> } }).repitch;
      if (repitch?.stopCapture) {
        repitch.stopCapture().catch((err) => console.error('[audioEngine] stopCapture failed:', err));
      }
      // Tell the worklet to terminate (process() returns false → processor is
      // destroyed). Otherwise the disconnected node keeps running and consuming
      // the shared ring, fighting the next start()'s node (garbled/silent audio).
      try { this.pcmPlayerNode?.port.postMessage({ type: 'stop' }); } catch { /* ignore */ }
      try { this.pcmPlayerNode?.disconnect(); } catch { /* ignore */ }
      this.pcmPlayerNode = null;
      this.ring = null;
      this.control = null;
      // Keep SABs alive for reuse on next start()
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
