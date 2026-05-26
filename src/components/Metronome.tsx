import React, { useCallback, useEffect, useState } from 'react';
import { metronomeEngine } from '../metronomeEngine';
import { audioEngine } from '../audioEngine';
import '../styles/Metronome.css';

const BEAT_OPTIONS = [1, 2, 3, 4, 5, 6];

interface MetronomeProps {
  flashEnabled: boolean;
  onFlashToggle: (enabled: boolean) => void;
}

const Metronome: React.FC<MetronomeProps> = ({ flashEnabled, onFlashToggle }) => {
  const [bpm, setBpm] = useState(100);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [isRunning, setIsRunning] = useState(false);
  const [activeBeat, setActiveBeat] = useState(-1);
  const [volume, setVolume] = useState(80);

  useEffect(() => {
    const unsub = metronomeEngine.onBeat((beat) => {
      setActiveBeat(beat);
    });
    return () => {
      unsub();
      metronomeEngine.stop();
    };
  }, []);

  const handleBpmChange = useCallback((value: number) => {
    const clamped = Math.max(40, Math.min(240, Math.round(value)));
    setBpm(clamped);
    metronomeEngine.setBpm(clamped);
  }, []);

  const handleBeatsPerBarChange = useCallback((n: number) => {
    setBeatsPerBar(n);
    metronomeEngine.setBeatsPerBar(n);
    setActiveBeat(-1);
  }, []);

  // Show the current tempo next to the menu-bar icon.
  useEffect(() => {
    (window as unknown as { repitch?: { setTrayInfo?: (t: string) => void } }).repitch?.setTrayInfo?.(
      `${bpm} BPM`
    );
  }, [bpm]);

  const handleVolumeChange = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(v)));
    setVolume(clamped);
    metronomeEngine.setVolume(clamped / 100);
  }, []);

  const handleToggle = useCallback(async () => {
    if (isRunning) {
      metronomeEngine.stop();
      setIsRunning(false);
      setActiveBeat(-1);
    } else {
      // Play to the physical device chosen in the Pitch Shifter (the system
      // default may be a loopback device like BlackHole, which would be silent).
      metronomeEngine.setOutputDevice(audioEngine.getStatus().outputDeviceId);
      await metronomeEngine.start();
      setIsRunning(true);
    }
  }, [isRunning]);

  return (
    <div className="metronome">
      <div className="metro-bpm-display">
        <span className="metro-bpm-value">{bpm}</span>
        <span className="metro-bpm-label">BPM</span>
      </div>

      <div className="metro-bpm-controls">
        <button
          className="metro-nudge"
          onClick={() => handleBpmChange(bpm - 1)}
          aria-label="Decrease BPM"
        >
          −
        </button>
        <input
          className="metro-slider"
          type="range"
          min={40}
          max={240}
          step={1}
          value={bpm}
          onChange={(e) => handleBpmChange(Number(e.target.value))}
        />
        <button
          className="metro-nudge"
          onClick={() => handleBpmChange(bpm + 1)}
          aria-label="Increase BPM"
        >
          +
        </button>
      </div>

      <div className="metro-bpm-input-row">
        <input
          className="metro-bpm-input"
          type="number"
          min={40}
          max={240}
          value={bpm}
          onChange={(e) => handleBpmChange(Number(e.target.value))}
        />
        <span className="metro-bpm-input-label">BPM</span>
      </div>

      <div className="metro-section-label">Beats per bar</div>
      <div className="beat-options">
        {BEAT_OPTIONS.map((n) => (
          <button
            key={n}
            className={`beat-option${beatsPerBar === n ? ' active' : ''}`}
            onClick={() => handleBeatsPerBarChange(n)}
          >
            {n}
          </button>
        ))}
      </div>

      <div className="beat-lights">
        {Array.from({ length: beatsPerBar }, (_, i) => (
          <div
            key={i}
            className={[
              'beat-light',
              i === 0 ? 'accent' : '',
              i === activeBeat ? 'active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          />
        ))}
      </div>

      <div className="metro-section-label">Volume {volume}%</div>
      <div className="metro-volume-row">
        <span className="metro-volume-icon">🔈</span>
        <input
          className="metro-slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={volume}
          onChange={(e) => handleVolumeChange(Number(e.target.value))}
          aria-label="Volume del click"
        />
        <span className="metro-volume-icon">🔊</span>
      </div>

      <button
        className={`metro-toggle${isRunning ? ' running' : ''}`}
        onClick={handleToggle}
      >
        {isRunning ? 'Stop' : 'Start'}
      </button>

      <label className="metro-flash">
        <input
          type="checkbox"
          checked={flashEnabled}
          onChange={(e) => onFlashToggle(e.target.checked)}
        />
        <span>Flash screen on beat</span>
      </label>
    </div>
  );
};

export default Metronome;
