import React, { useEffect, useState } from 'react';
import { audioEngine, EngineStatus } from '../audioEngine';
import PitchControl from './PitchControl';
import Visualizer from './Visualizer';

/**
 * Pitch-shifter tool. The engine auto-starts and runs for the whole session
 * (managed by App.tsx); this component only reflects state and controls
 * pitch/bypass.
 */
const PitchShifter: React.FC = () => {
  const [status, setStatus] = useState<EngineStatus>(audioEngine.getStatus());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = audioEngine.onStatus((s) => {
      setStatus(s);
      setError(null);
    });
    return unsubscribe;
  }, []);

  // Show the current pitch (and bypass state) next to the menu-bar icon.
  useEffect(() => {
    const st = status.pitchSemitones;
    const det = status.detuneCents;
    const detStr = det !== 0 ? ` ${det > 0 ? '+' : ''}${det}¢` : '';
    const info = status.bypassed
      ? `Pitch ${st > 0 ? '+' : ''}${st} st${detStr} · BYPASS`
      : `Pitch ${st > 0 ? '+' : ''}${st} st${detStr}`;
    (window as unknown as { repitch?: { setTrayInfo?: (t: string) => void } }).repitch?.setTrayInfo?.(
      info
    );
  }, [status.pitchSemitones, status.detuneCents, status.bypassed]);

  const analyser = audioEngine.getAnalyser();

  return (
    <div className="pitch-layout">
      <div className="pitch-visual">
        {analyser && status.running ? (
          <Visualizer analyser={analyser} />
        ) : (
          <div className="pitch-visual-placeholder">Starting…</div>
        )}
      </div>

      <div className="pitch-controls-col">
        <div className="status-row">
          <div className={`status-indicator ${status.running ? 'connected' : 'disconnected'}`}>
            <div className="status-dot"></div>
            <span className="status-text">
              {status.running ? 'Processing system audio' : 'Starting…'}
            </span>
          </div>
          <button
            className={`bypass-button ${status.bypassed ? 'active' : ''}`}
            onClick={() => audioEngine.setBypassed(!status.bypassed)}
            disabled={!status.running}
            aria-label={status.bypassed ? 'Enable pitch shifting' : 'Bypass pitch shifting'}
          >
            {status.bypassed ? 'BYPASS: ON' : 'BYPASS: OFF'}
          </button>
        </div>

        {error && (
          <div className="error-banner">
            <span className="error-icon">⚠</span>
            <span className="error-text">{error}</span>
          </div>
        )}

        <PitchControl
          isRunning={status.running}
          currentPitch={status.pitchSemitones}
          onPitchChange={(semitones) => audioEngine.setPitchSemitones(semitones)}
          detuneCents={status.detuneCents}
          onDetuneChange={(cents) => audioEngine.setDetuneCents(cents)}
        />

        <footer className="app-footer">
          <div className="footer-info">
            <span className="info-label">Sample Rate:</span>
            <span className="info-value">{status.sampleRate} Hz</span>
          </div>
          <div className="footer-info">
            <span className="info-label">Latency:</span>
            <span className="info-value">{status.latencyMs || '—'} ms</span>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default PitchShifter;
