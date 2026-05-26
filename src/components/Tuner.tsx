import React, { useEffect, useRef, useState, useCallback } from 'react';
import { tunerEngine } from '../tunerEngine';
import '../styles/Tuner.css';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CLARITY_THRESHOLD = 0.4;
const NEEDLE_RANGE = 50; // cents

interface Reading {
  frequency: number;
  clarity: number;
}

function findNearestMidi(midiFloat: number, pitchClass: number): number {
  const base = Math.round(midiFloat);
  // Find the integer k closest to midiFloat where ((k % 12) + 12) % 12 === pitchClass
  let best = base - 6;
  let bestDist = Infinity;
  for (let k = base - 6; k <= base + 6; k++) {
    if (((k % 12) + 12) % 12 === pitchClass) {
      const dist = Math.abs(midiFloat - k);
      if (dist < bestDist) {
        bestDist = dist;
        best = k;
      }
    }
  }
  return best;
}

interface TunerProps {
  inputDeviceId?: string;
}

const Tuner: React.FC<TunerProps> = ({ inputDeviceId }) => {
  const [referenceHz, setReferenceHz] = useState(440);
  const [targetNote, setTargetNote] = useState<number | 'auto'>('auto');
  const [reading, setReading] = useState<Reading>({ frequency: -1, clarity: 0 });
  const [micError, setMicError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveRafRef = useRef<number | null>(null);
  // Smoothing state: reject outliers (median) + ease (EMA) + throttle the UI so
  // the readout is stable and readable instead of jittery.
  const recentRef = useRef<number[]>([]);
  const smoothedRef = useRef<number>(-1);
  const lastEmitRef = useRef<number>(0);

  // Start/stop tuner engine on mount/unmount (restarts when inputDeviceId changes)
  useEffect(() => {
    setMicError(null);
    recentRef.current = [];
    smoothedRef.current = -1;
    lastEmitRef.current = 0;
    tunerEngine.start(inputDeviceId).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setMicError(
        msg.includes('Permission') || msg.includes('permission') || msg.includes('NotAllowed')
          ? 'Microphone access denied. Enable the microphone in System Settings.'
          : `Could not start the microphone: ${msg}`
      );
    });

    const unsubscribe = tunerEngine.onReading((frequency, clarity) => {
      const now = performance.now();
      if (frequency > 0 && clarity >= CLARITY_THRESHOLD) {
        const arr = recentRef.current;
        arr.push(frequency);
        if (arr.length > 8) arr.shift();
        const sorted = [...arr].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        if (smoothedRef.current <= 0) smoothedRef.current = median;
        else smoothedRef.current += 0.18 * (median - smoothedRef.current);
      } else {
        recentRef.current = [];
      }
      // Throttle React updates to ~12/s with the smoothed value.
      if (now - lastEmitRef.current >= 80) {
        lastEmitRef.current = now;
        const valid = recentRef.current.length >= 3;
        setReading(valid ? { frequency: smoothedRef.current, clarity: 1 } : { frequency: -1, clarity: 0 });
      }
    });

    return () => {
      unsubscribe();
      tunerEngine.stop().catch(() => { /* ignore */ });
    };
  }, [inputDeviceId]);

  // Waveform canvas draw loop
  const drawWave = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const analyser = tunerEngine.getAnalyser();
    if (!analyser) {
      waveRafRef.current = requestAnimationFrame(drawWave);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const bufLen = analyser.fftSize;
    const timeDomain = new Uint8Array(bufLen);
    analyser.getByteTimeDomainData(timeDomain);

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f7cff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    const step = bufLen / w;
    for (let x = 0; x < w; x++) {
      const v = timeDomain[Math.floor(x * step)] / 128.0 - 1;
      const y = h / 2 + (v * h) / 2.1;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    waveRafRef.current = requestAnimationFrame(drawWave);
  }, []);

  useEffect(() => {
    waveRafRef.current = requestAnimationFrame(drawWave);
    return () => {
      if (waveRafRef.current !== null) cancelAnimationFrame(waveRafRef.current);
    };
  }, [drawWave]);

  // --- Pitch math ---
  const { frequency, clarity } = reading;
  const hasSignal = frequency > 0 && clarity >= CLARITY_THRESHOLD;

  let noteName = '—';
  let octave: number | null = null;
  let cents = 0;
  let inTune = false;
  let displayFreq = '';

  if (hasSignal) {
    displayFreq = `${frequency.toFixed(1)} Hz`;
    const midiFloat = 69 + 12 * Math.log2(frequency / referenceHz);

    if (targetNote === 'auto') {
      // Note identity from the A=440 standard grid (stays stable regardless of
      // the chosen reference); deviation measured against the chosen reference.
      // So the same sound reads sharper as you lower the reference, e.g. a
      // 440 Hz tone at A=415 shows "A" about +100 cents (crescentissimo).
      const midiStd = 69 + 12 * Math.log2(frequency / 440);
      const nearest = Math.round(midiStd);
      cents = Math.round(100 * (midiFloat - nearest));
      noteName = NOTES[((nearest % 12) + 12) % 12];
      octave = Math.floor(nearest / 12) - 1;
    } else {
      const k = findNearestMidi(midiFloat, targetNote);
      cents = Math.round(100 * (midiFloat - k));
      noteName = NOTES[targetNote];
      octave = Math.floor(k / 12) - 1;
    }

    inTune = Math.abs(cents) <= 5;
  }

  const needlePercent = hasSignal ? 50 + Math.max(-NEEDLE_RANGE, Math.min(NEEDLE_RANGE, cents)) : 50;
  const needleColor = hasSignal ? (inTune ? 'var(--success)' : 'var(--danger)') : 'var(--text-muted)';

  let tuningLabel = '';
  if (hasSignal) {
    if (inTune) tuningLabel = '● in tune';
    else if (cents > 5) tuningLabel = '♯ sharp';
    else tuningLabel = '♭ flat';
  }

  const centsDisplay = hasSignal ? (cents > 0 ? `+${cents}` : `${cents}`) : '';

  const refCents = Math.round(1200 * Math.log2(referenceHz / 440));
  const refLabel = refCents === 0 ? 'Standard (440 Hz)' : `${refCents > 0 ? '+' : ''}${refCents} cents vs 440 Hz`;

  // Show the detected note next to the menu-bar icon.
  const trayText = hasSignal ? `${noteName}${octave ?? ''} ${centsDisplay}¢` : 'Tuner';
  useEffect(() => {
    (window as unknown as { repitch?: { setTrayInfo?: (t: string) => void } }).repitch?.setTrayInfo?.(
      trayText
    );
  }, [trayText]);

  return (
    <div className="tuner">
      {micError && (
        <div className="tuner-error">{micError}</div>
      )}

      <div className="tuner-2col">
        <div className="tuner-col">
          {/* Main display */}
          <div className="tuner-display">
            <div className={`tuner-note ${hasSignal ? (inTune ? 'in-tune' : 'out-of-tune') : 'no-signal'}`}>
              {noteName}{octave !== null ? <span className="tuner-octave">{octave}</span> : null}
            </div>
            <div className="tuner-freq">
              {hasSignal ? displayFreq : 'Play a note'}
            </div>
          </div>

          {/* Meter */}
          <div className="tuner-meter-wrap">
            <div className="tuner-meter-ticks">
              {[-50, -25, 0, 25, 50].map((v) => (
                <span
                  key={v}
                  className="tuner-tick"
                  style={{ left: `${50 + v}%` }}
                >
                  {v === 0 ? '|' : String(v)}
                </span>
              ))}
            </div>
            <div className="tuner-meter">
              <div className="tuner-meter-center" />
              <div
                className={`tuner-needle ${inTune && hasSignal ? 'in-tune' : ''}`}
                style={{
                  left: `${needlePercent}%`,
                  backgroundColor: needleColor,
                  boxShadow: hasSignal ? `0 0 8px 2px ${needleColor}` : 'none',
                }}
              />
            </div>
            <div className="tuner-meter-labels">
              <span style={{ color: 'var(--danger)' }}>♭</span>
              <div className="tuner-meter-status">
                {hasSignal && (
                  <>
                    <span className={`tuner-cents ${inTune ? 'in-tune' : 'out-of-tune'}`}>{centsDisplay} ¢</span>
                    <span className={`tuner-label ${inTune ? 'in-tune' : 'out-of-tune'}`}>{tuningLabel}</span>
                  </>
                )}
              </div>
              <span style={{ color: 'var(--danger)' }}>♯</span>
            </div>
          </div>
        </div>

        <div className="tuner-col">
          {/* Waveform */}
          <div className="tuner-wave-wrap">
            <canvas ref={canvasRef} className="tuner-wave" />
          </div>

          {/* Controls */}
          <div className="tuner-controls">
            {/* Reference Hz slider */}
            <div className="slider-section">
              <div className="pitch-display">
                <div className="pitch-semitones">{referenceHz.toFixed(1)} Hz</div>
                <div className="pitch-note">{refLabel}</div>
              </div>
              <input
                type="range"
                min={415}
                max={466}
                step={0.5}
                value={referenceHz}
                onChange={(e) => setReferenceHz(Number(e.target.value))}
                className="pitch-slider"
                aria-label="Reference A frequency (Hz)"
              />
              <div className="slider-labels">
                <span>415</span>
                <span>440</span>
                <span>466</span>
              </div>
            </div>

            {/* Target note selector */}
            <div className="tuner-note-select-wrap">
              <label className="tuner-note-label" htmlFor="tuner-note-select">
                Target note
              </label>
              <select
                id="tuner-note-select"
                className="tuner-note-select"
                value={targetNote === 'auto' ? 'auto' : String(targetNote)}
                onChange={(e) => {
                  const v = e.target.value;
                  setTargetNote(v === 'auto' ? 'auto' : Number(v));
                }}
              >
                <option value="auto">Auto (nearest note)</option>
                {NOTES.map((n, i) => (
                  <option key={n} value={String(i)}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Tuner;
