import React, { useEffect, useRef, useState } from 'react';
import { audioEngine, EngineStatus } from '../audioEngine';
import PitchControl from './PitchControl';

/**
 * Pitch-shifter tool. Mounted only while its tab is active; starts the engine
 * on mount (gesture-aware) and stops it on unmount so switching tabs releases
 * the capture device.
 */
const PitchShifter: React.FC = () => {
  const [status, setStatus] = useState<EngineStatus>(audioEngine.getStatus());
  const [error, setError] = useState<string | null>(null);
  const startingRef = useRef(false);

  useEffect(() => {
    const unsubscribe = audioEngine.onStatus((s) => {
      setStatus(s);
      setError(null);
    });
    return unsubscribe;
  }, []);

  // Auto-start (no explicit button). getDisplayMedia/resume usually need a
  // gesture, so try at mount and on the first interaction. Stop on unmount.
  useEffect(() => {
    let done = false;
    const tryStart = async (fromGesture: boolean) => {
      if (done || startingRef.current || audioEngine.getStatus().running) return;
      startingRef.current = true;
      try {
        await audioEngine.start();
        done = true;
        cleanup();
      } catch (err) {
        if (fromGesture) setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        startingRef.current = false;
      }
    };
    const onGesture = () => {
      void tryStart(true);
    };
    const cleanup = () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    void tryStart(false);
    return () => {
      cleanup();
      void audioEngine.stop();
    };
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

  return (
    <>
      <div className="status-row">
        <div className={`status-indicator ${status.running ? 'connected' : 'disconnected'}`}>
          <div className="status-dot"></div>
          <span className="status-text">
            {status.running ? 'Processing system audio' : 'Click anywhere to start'}
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

      <main className="main-content">
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
          analyser={audioEngine.getAnalyser()}
        />
      </main>

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
    </>
  );
};

export default PitchShifter;
