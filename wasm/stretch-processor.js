/*
 * AudioWorklet processor that drives Signalsmith Stretch (compiled to WASM) as
 * a real-time pitch shifter on a LIVE input stream.
 *
 * This file is concatenated AFTER the Emscripten glue (which defines the global
 * factory `createStretchModule`) by wasm/build.sh, producing
 * public/signalsmith-worklet.js.
 *
 * Processor name: 'signalsmith-stretch-processor'
 * Param: semitones (k-rate) — pitch shift in semitones, 0 = no shift.
 */

class SignalsmithProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'semitones',
        defaultValue: 0,
        minValue: -24,
        maxValue: 24,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();
    this.ready = false;
    this.lastSemi = null;
    this.channels = 2;
    this.N = 128; // Web Audio render quantum

    // Instantiate the embedded WASM module (SINGLE_FILE build => no fetch).
    createStretchModule().then((mod) => {
      this.mod = mod;
      mod._stretch_create(this.channels, sampleRate);
      const bytes = this.N * 4;
      this.pIn0 = mod._malloc(bytes);
      this.pIn1 = mod._malloc(bytes);
      this.pOut0 = mod._malloc(bytes);
      this.pOut1 = mod._malloc(bytes);
      this.ready = true;

      // Report Signalsmith's algorithmic latency back to the main thread.
      const samples = mod._stretch_input_latency() + mod._stretch_output_latency();
      this.port.postMessage({ type: 'latency', samples });
    });
  }

  process(inputs, outputs, parameters) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;

    if (!this.ready) {
      for (let c = 0; c < out.length; c++) out[c].fill(0);
      return true;
    }

    const mod = this.mod;
    const HF = mod.HEAPF32;
    const N = this.N;

    const semiParam = parameters.semitones;
    const semi = semiParam.length > 0 ? semiParam[0] : 0;
    if (semi !== this.lastSemi) {
      mod._stretch_set_transpose(semi);
      this.lastSemi = semi;
    }

    const inp = inputs[0];
    const in0 = inp && inp[0] ? inp[0] : null;
    const in1 = inp && inp[1] ? inp[1] : in0;

    const i0 = this.pIn0 >> 2;
    const i1 = this.pIn1 >> 2;
    if (in0) HF.set(in0, i0);
    else HF.fill(0, i0, i0 + N);
    if (in1) HF.set(in1, i1);
    else HF.fill(0, i1, i1 + N);

    mod._stretch_process2(this.pIn0, this.pIn1, N, this.pOut0, this.pOut1, N);

    const o0 = this.pOut0 >> 2;
    const o1 = this.pOut1 >> 2;
    out[0].set(HF.subarray(o0, o0 + N));
    if (out[1]) out[1].set(HF.subarray(o1, o1 + N));
    return true;
  }
}

registerProcessor('signalsmith-stretch-processor', SignalsmithProcessor);
