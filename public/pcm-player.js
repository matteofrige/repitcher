/**
 * pcm-player.js — AudioWorkletProcessor SPSC per riproduzione PCM stereo in real-time.
 *
 * Legge campioni Float32 stereo interleaved (L,R,L,R...) da un ring buffer
 * condiviso (SharedArrayBuffer) e li scrive sui 2 canali di uscita.
 * Pre-roll di N frame prima di iniziare per ammortizzare la latenza IPC.
 *
 * controlSAB (Int32Array, 3 elementi) — indici in unità di CAMPIONI INTERLEAVED:
 *   [0] writeIndex    — indice assoluto di scrittura (produttore nel renderer)
 *   [1] readIndex     — indice assoluto di lettura  (questo processor)
 *   [2] underrunCount — blocchi con frame mancanti (glitch)
 */
class PCMPlayer extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    const { ringSAB, controlSAB, capacity, prerollFrames } = options.processorOptions;

    // Vista Float32 sul ring buffer (campioni interleaved)
    this.ring     = new Float32Array(ringSAB);
    // capacity = numero totale di campioni interleaved nel ring
    this.capacity = capacity;

    // Vista Int32 sui controlli condivisi
    this.control  = new Int32Array(controlSAB);

    // Pre-roll: aspetta che ci siano almeno prerollFrames FRAME stereo prima di suonare
    this.prerollFrames = prerollFrames;
    this.started       = false;

    // Flag di terminazione: quando il nodo viene fermato (stop()), process()
    // ritorna false così il processore viene DISTRUTTO. Senza questo, un nodo
    // disconnesso che ritorna sempre true resta vivo e continua a consumare il
    // ring buffer condiviso, entrando in conflitto col nuovo nodo al restart.
    this.stopped = false;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'stop') this.stopped = true;
    };
  }

  process(_, outputs) {
    // Terminazione esplicita: libera il processore (non verrà più richiamato)
    if (this.stopped) return false;

    const out    = outputs[0];
    const frames = out[0].length; // di solito 128 frame

    const w = Atomics.load(this.control, 0);
    let r = Atomics.load(this.control, 1);

    // Campioni disponibili / 2 = frame stereo disponibili
    let availFrames = Math.floor((w - r) / 2);

    // Compensazione latenza/drift: se il buffer cresce troppo (clock drift tra
    // device di cattura e di uscita, o riempimento transitorio al restart),
    // salta i campioni vecchi per riportare la latenza al target (~preroll).
    // Senza questo la latenza può salire fino alla capienza del ring (~2s).
    const maxFrames = this.prerollFrames * 4;
    if (this.started && availFrames > maxFrames) {
      const dropFrames = availFrames - this.prerollFrames;
      r += dropFrames * 2;
      Atomics.store(this.control, 1, r);
      availFrames = this.prerollFrames;
    }

    // --- Fase di pre-roll: aspetta che il buffer sia sufficientemente pieno ---
    if (!this.started) {
      if (availFrames < this.prerollFrames) {
        // Silenzio — il buffer si sta riempiendo
        out[0].fill(0);
        out[1].fill(0);
        return true;
      }
      this.started = true;
    }

    // --- Riproduzione stereo ---
    const n = Math.min(frames, availFrames);
    let hadUnderrun = false;

    for (let i = 0; i < frames; i++) {
      if (i < n) {
        // Frame disponibile: L e R dal ring interleaved
        out[0][i] = this.ring[(r + 2 * i)     % this.capacity];
        out[1][i] = this.ring[(r + 2 * i + 1) % this.capacity];
      } else {
        // Buffer esaurito → silenzio, segna underrun
        out[0][i] = 0;
        out[1][i] = 0;
        hadUnderrun = true;
      }
    }

    // Un solo incremento atomico per burst di underrun (evita write-storm)
    if (hadUnderrun) {
      Atomics.add(this.control, 2, 1);
    }

    // Avanza il read index di quanti CAMPIONI interleaved abbiamo consumato (n frame × 2)
    Atomics.store(this.control, 1, r + 2 * n);

    return true; // mantieni il processor vivo
  }
}

registerProcessor('pcm-player', PCMPlayer);
