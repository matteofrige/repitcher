/*
 * High-quality real-time pitch shifter as an AudioWorklet.
 *
 * Port of Stephan M. Bernsee's classic `smbPitchShift` phase-vocoder
 * (the "Pitch Shifting Using The Fourier Transform" reference implementation,
 * freely reusable). Unlike a granular/delay-line shifter, a phase vocoder keeps
 * the pitch rock-steady (no warble) at the cost of latency and a little
 * transient smearing — which is exactly the quality/stability trade-off we want.
 *
 * Processor name: 'smb-pitch-shift-processor'
 * Param: pitchFactor (k-rate) = 2^(semitones/12). 1.0 = no shift.
 */

const PI = Math.PI;
const TWO_PI = 2 * Math.PI;

// In-place complex FFT on an interleaved [re, im, re, im, ...] buffer.
// sign = -1 forward, +1 inverse. (Faithful port of smbFft.)
function smbFft(buf, fftFrameSize, sign) {
  // Bit-reversal reordering.
  for (let i = 2; i < 2 * fftFrameSize - 2; i += 2) {
    let j = 0;
    for (let bitm = 2; bitm < 2 * fftFrameSize; bitm <<= 1) {
      if (i & bitm) j++;
      j <<= 1;
    }
    if (i < j) {
      let t = buf[i];
      buf[i] = buf[j];
      buf[j] = t;
      t = buf[i + 1];
      buf[i + 1] = buf[j + 1];
      buf[j + 1] = t;
    }
  }

  const kmax = Math.round(Math.log(fftFrameSize) / Math.LN2);
  let le = 2;
  for (let k = 0; k < kmax; k++) {
    le <<= 1;
    const le2 = le >> 1;
    let ur = 1.0;
    let ui = 0.0;
    const arg = PI / (le2 >> 1);
    const wr = Math.cos(arg);
    const wi = sign * Math.sin(arg);
    for (let j = 0; j < le2; j += 2) {
      for (let i = j; i < 2 * fftFrameSize; i += le) {
        const p1r = i;
        const p1i = i + 1;
        const p2r = i + le2;
        const p2i = i + le2 + 1;
        const tr = buf[p2r] * ur - buf[p2i] * ui;
        const ti = buf[p2r] * ui + buf[p2i] * ur;
        buf[p2r] = buf[p1r] - tr;
        buf[p2i] = buf[p1i] - ti;
        buf[p1r] += tr;
        buf[p1i] += ti;
      }
      const tr2 = ur * wr - ui * wi;
      ui = ur * wi + ui * wr;
      ur = tr2;
    }
  }
}

class SmbPitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'pitchFactor',
        defaultValue: 1.0,
        minValue: 0.25,
        maxValue: 4.0,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();
    // Larger frame + higher oversampling => smoother, more stable pitch.
    this.fftFrameSize = 4096;
    this.osamp = 16;
    this.states = [];
  }

  ensureState(ch) {
    while (this.states.length <= ch) {
      const N = this.fftFrameSize;
      // Precompute the Hann window once (reused for analysis and synthesis).
      const hannWindow = new Float32Array(N);
      for (let k = 0; k < N; k++) {
        hannWindow[k] = -0.5 * Math.cos((TWO_PI * k) / N) + 0.5;
      }
      this.states.push({
        gInFIFO: new Float32Array(N),
        gOutFIFO: new Float32Array(N),
        gFFTworksp: new Float32Array(2 * N),
        gLastPhase: new Float32Array(N / 2 + 1),
        gSumPhase: new Float32Array(N / 2 + 1),
        gOutputAccum: new Float32Array(2 * N),
        gAnaFreq: new Float32Array(N),
        gAnaMagn: new Float32Array(N),
        gSynFreq: new Float32Array(N),
        gSynMagn: new Float32Array(N),
        // Cached per-bin synthesis phasor components (perf).
        synCos: new Float32Array(N / 2 + 1),
        synSin: new Float32Array(N / 2 + 1),
        hannWindow,
        gRover: 0,
        // Slow level-matching state.
        meanInSq: 0,
        meanOutSq: 0,
        makeupGain: 1,
      });
    }
    return this.states[ch];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const pf = parameters.pitchFactor;
    const pitchShift = pf.length > 0 ? pf[0] : 1.0;

    for (let ch = 0; ch < output.length; ch++) {
      const outCh = output[ch];
      const inCh = input && input.length > 0 ? input[ch] || input[0] : null;
      if (!inCh) {
        outCh.fill(0);
        continue;
      }
      this.processChannel(this.ensureState(ch), inCh, outCh, outCh.length, pitchShift);
    }
    return true;
  }

  processChannel(st, indata, outdata, numSamps, pitchShift) {
    const fftFrameSize = this.fftFrameSize;
    const osamp = this.osamp;
    const fftFrameSize2 = fftFrameSize / 2;
    const stepSize = fftFrameSize / osamp;
    const freqPerBin = sampleRate / fftFrameSize;
    const expct = (TWO_PI * stepSize) / fftFrameSize;
    const inFifoLatency = fftFrameSize - stepSize;

    if (st.gRover === 0) st.gRover = inFifoLatency;

    // Slow level matching: keep the processed loudness equal to the source so
    // it matches the bypass level. Long time constants correct the static gain
    // loss of the phase-locked vocoder without pumping on musical dynamics.
    const rmsAlpha = 1 / (1.0 * sampleRate); // ~1 s RMS averaging window
    const gainAlpha = 1 / (0.4 * sampleRate); // ~0.4 s gain smoothing

    for (let i = 0; i < numSamps; i++) {
      const inSample = indata[i];
      st.gInFIFO[st.gRover] = inSample;
      const outSample = st.gOutFIFO[st.gRover - inFifoLatency];

      st.meanInSq += rmsAlpha * (inSample * inSample - st.meanInSq);
      st.meanOutSq += rmsAlpha * (outSample * outSample - st.meanOutSq);
      // Only adapt when there is meaningful signal, and bound the correction.
      if (st.meanInSq > 1e-6 && st.meanOutSq > 1e-9) {
        let desired = Math.sqrt(st.meanInSq / st.meanOutSq);
        if (desired > 2) desired = 2;
        else if (desired < 0.5) desired = 0.5;
        st.makeupGain += gainAlpha * (desired - st.makeupGain);
      }

      outdata[i] = outSample * st.makeupGain;
      st.gRover++;

      if (st.gRover >= fftFrameSize) {
        st.gRover = inFifoLatency;

        // --- Analysis: window + forward FFT. ---
        for (let k = 0; k < fftFrameSize; k++) {
          st.gFFTworksp[2 * k] = st.gInFIFO[k] * st.hannWindow[k];
          st.gFFTworksp[2 * k + 1] = 0;
        }
        smbFft(st.gFFTworksp, fftFrameSize, -1);

        for (let k = 0; k <= fftFrameSize2; k++) {
          const real = st.gFFTworksp[2 * k];
          const imag = st.gFFTworksp[2 * k + 1];
          const magn = 2 * Math.sqrt(real * real + imag * imag);
          const phase = Math.atan2(imag, real);

          let tmp = phase - st.gLastPhase[k];
          st.gLastPhase[k] = phase;

          tmp -= k * expct;

          // Map delta phase into +/- Pi interval.
          let qpd = Math.trunc(tmp / PI);
          if (qpd >= 0) qpd += qpd & 1;
          else qpd -= qpd & 1;
          tmp -= PI * qpd;

          // Deviation from bin frequency, then true frequency in Hz.
          tmp = (osamp * tmp) / TWO_PI;
          tmp = k * freqPerBin + tmp * freqPerBin;

          st.gAnaMagn[k] = magn;
          st.gAnaFreq[k] = tmp;
        }

        // --- Processing: pitch shift by binning. ---
        for (let k = 0; k <= fftFrameSize2; k++) {
          st.gSynMagn[k] = 0;
          st.gSynFreq[k] = 0;
        }
        for (let k = 0; k <= fftFrameSize2; k++) {
          const index = Math.trunc(k * pitchShift);
          if (index <= fftFrameSize2) {
            st.gSynMagn[index] += st.gAnaMagn[k];
            st.gSynFreq[index] = st.gAnaFreq[k] * pitchShift;
          }
        }

        // --- Synthesis: phase propagation, then loose phase locking. ---
        // Step 1: integrate the per-bin synthesis phase (this is what keeps the
        // pitch rock-steady across frames).
        for (let k = 0; k <= fftFrameSize2; k++) {
          let tmp = st.gSynFreq[k];
          tmp -= k * freqPerBin;
          tmp /= freqPerBin;
          tmp = (TWO_PI * tmp) / osamp;
          tmp += k * expct;
          st.gSumPhase[k] += tmp;
          // Cache the phasor components so the locking loop below reuses them
          // instead of recomputing cos/sin for each bin and its neighbours.
          st.synCos[k] = Math.cos(st.gSumPhase[k]);
          st.synSin[k] = Math.sin(st.gSumPhase[k]);
        }
        // Step 2: loose phase locking (Puckette). Couple each bin's output phase
        // to its neighbours by summing the magnitude-weighted phasors (reusing
        // the cached components) and taking the resulting angle. This restores
        // vertical phase coherence around spectral peaks and removes most of the
        // "metallic/phasey" artefact, while the accumulator above (untouched
        // here) preserves pitch stability.
        for (let k = 0; k <= fftFrameSize2; k++) {
          const magn = st.gSynMagn[k];
          let sr = magn * st.synCos[k];
          let si = magn * st.synSin[k];
          if (k > 0) {
            sr += st.gSynMagn[k - 1] * st.synCos[k - 1];
            si += st.gSynMagn[k - 1] * st.synSin[k - 1];
          }
          if (k < fftFrameSize2) {
            sr += st.gSynMagn[k + 1] * st.synCos[k + 1];
            si += st.gSynMagn[k + 1] * st.synSin[k + 1];
          }
          const theta = Math.atan2(si, sr);
          st.gFFTworksp[2 * k] = magn * Math.cos(theta);
          st.gFFTworksp[2 * k + 1] = magn * Math.sin(theta);
        }

        // Zero the negative-frequency bins above Nyquist.
        for (let k = fftFrameSize + 2; k < 2 * fftFrameSize; k++) {
          st.gFFTworksp[k] = 0;
        }

        smbFft(st.gFFTworksp, fftFrameSize, 1);

        // Windowed overlap-add into the accumulator.
        for (let k = 0; k < fftFrameSize; k++) {
          st.gOutputAccum[k] +=
            (2 * st.hannWindow[k] * st.gFFTworksp[2 * k]) / (fftFrameSize2 * osamp);
        }
        for (let k = 0; k < stepSize; k++) {
          st.gOutFIFO[k] = st.gOutputAccum[k];
        }

        // Shift the accumulator.
        for (let k = 0; k < fftFrameSize; k++) {
          st.gOutputAccum[k] = st.gOutputAccum[k + stepSize];
        }
        // Shift the input FIFO.
        for (let k = 0; k < inFifoLatency; k++) {
          st.gInFIFO[k] = st.gInFIFO[k + stepSize];
        }
      }
    }
  }
}

registerProcessor('smb-pitch-shift-processor', SmbPitchShiftProcessor);
