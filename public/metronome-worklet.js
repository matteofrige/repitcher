/**
 * metronome-worklet.js — AudioWorkletProcessor per il click del metronomo.
 *
 * Genera i click contando i campioni (sample-accurate) invece di affidarsi a
 * setInterval sul main thread: il timing non dipende dal jank del main
 * thread né dal renderer, quindi non c'è ritardo/deriva sui battiti.
 */
class MetronomeProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    this.running = false;
    this.bpm = 100;
    this.beatsPerBar = 4;
    this.beat = 0; // indice del prossimo battito

    // Contatore frame totali dall'avvio. double (NON intero): usiamo un
    // accumulatore frazionario per nextBeatFrame così non c'è deriva
    // cumulativa dovuta ad arrotondamenti ripetuti.
    this.frame = 0;
    this.nextBeatFrame = 0;
    this.samplesPerBeat = (sampleRate * 60) / this.bpm;

    // Stato di sintesi del click corrente. Un solo click alla volta: se ne
    // parte uno nuovo, quello precedente viene semplicemente sovrascritto.
    this.clickPos = -1; // campioni trascorsi dall'inizio del click, -1 = nessun click attivo
    this.clickFreq = 0;
    this.clickAmp = 0;
    this.clickPhase = 0;
    this.clickPhaseInc = 0;

    // Parametri d'inviluppo del click, in campioni (dipendono da sampleRate).
    this.attackSamples = Math.max(1, Math.round(0.001 * sampleRate)); // 1 ms
    this.decayTau = 0.012 * sampleRate; // costante di tempo decadimento ~12 ms
    this.clickDurationSamples = Math.round(0.06 * sampleRate); // durata totale 60 ms

    this.port.onmessage = (e) => {
      const data = e.data;
      if (!data || typeof data.type !== 'string') return;

      if (data.type === 'start') {
        this.running = true;
        this.beat = 0;
        this.frame = 0;
        this.nextBeatFrame = 0; // primo click immediato
      } else if (data.type === 'stop') {
        this.running = false;
        this.clickPos = -1; // azzera il click in corso (silenzio)
      } else if (data.type === 'config') {
        const oldSamplesPerBeat = this.samplesPerBeat;
        if (typeof data.bpm === 'number' && data.bpm > 0) {
          this.bpm = data.bpm;
        }
        this.samplesPerBeat = (sampleRate * 60) / this.bpm;

        if (this.running) {
          // Applica subito il nuovo tempo senza saltare un battito: ricalcola
          // il prossimo colpo a partire dall'ultimo battito effettivamente
          // suonato, usando l'intervallo nuovo.
          const lastBeatFrame = this.nextBeatFrame - oldSamplesPerBeat;
          this.nextBeatFrame = Math.max(this.frame, lastBeatFrame + this.samplesPerBeat);
        }

        if (typeof data.beatsPerBar === 'number' && data.beatsPerBar > 0) {
          this.beatsPerBar = data.beatsPerBar;
          if (this.beat >= this.beatsPerBar) this.beat = 0;
        }
      }
    };
  }

  /** Avvia un nuovo click: fase resettata a 0 così il tono è identico ad ogni colpo. */
  startClick(accent) {
    this.clickFreq = accent ? 1600 : 950;
    this.clickAmp = accent ? 0.8 : 0.5;
    this.clickPhase = 0;
    this.clickPhaseInc = (2 * Math.PI * this.clickFreq) / sampleRate;
    this.clickPos = 0;
  }

  /** Campiona il click corrente (inviluppo attacco lineare + decadimento esponenziale). */
  nextClickSample() {
    if (this.clickPos < 0 || this.clickPos >= this.clickDurationSamples) {
      this.clickPos = -1;
      return 0;
    }

    let envelope;
    if (this.clickPos < this.attackSamples) {
      // Attacco lineare 0 → amp
      envelope = this.clickAmp * (this.clickPos / this.attackSamples);
    } else {
      // Decadimento esponenziale dopo l'attacco
      const t = this.clickPos - this.attackSamples;
      envelope = this.clickAmp * Math.exp(-t / this.decayTau);
    }

    const sample = Math.sin(this.clickPhase) * envelope;
    this.clickPhase += this.clickPhaseInc;
    this.clickPos++;
    return sample;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1];
    const frames = left.length;

    for (let i = 0; i < frames; i++) {
      // Confronto per singolo frame (non una volta per blocco): il click
      // parte con precisione di sub-blocco.
      if (this.running && this.frame >= this.nextBeatFrame) {
        const beat = this.beat;
        const accent = beat === 0;
        this.startClick(accent);
        this.port.postMessage({ type: 'beat', beat, accent });
        this.nextBeatFrame += this.samplesPerBeat;
        this.beat = (this.beat + 1) % this.beatsPerBar;
      }

      const sample = this.nextClickSample();
      left[i] = sample;
      if (right) right[i] = sample;

      this.frame++;
    }

    return true;
  }
}

registerProcessor('metronome-processor', MetronomeProcessor);
