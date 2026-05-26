import React from 'react';
import '../styles/PitchControl.css';

interface PitchControlProps {
  isRunning: boolean;
  currentPitch: number;
  onPitchChange: (semitones: number) => void;
  detuneCents: number;
  onDetuneChange: (cents: number) => void;
}

const PitchControl: React.FC<PitchControlProps> = ({
  isRunning,
  currentPitch,
  onPitchChange,
  detuneCents,
  onDetuneChange,
}) => {
  const getNoteNameFromSemitones = (semitones: number): string => {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const baseIndex = 9; // A is at index 9 (A4 = reference, 0 semitones)
    if (semitones === 0) return 'A';
    const noteIndex = (baseIndex + semitones) % 12;
    const octaveOffset = Math.floor((baseIndex + semitones) / 12);
    const octave = 4 + octaveOffset;
    return `${notes[noteIndex >= 0 ? noteIndex : 12 + noteIndex]}${octave}`;
  };

  const semitoneLabel = currentPitch > 0 ? `+${currentPitch}` : `${currentPitch}`;
  const noteName = getNoteNameFromSemitones(currentPitch);

  const detuneLabel = `${detuneCents > 0 ? '+' : ''}${detuneCents} ¢`;
  // Relative Hz shift the detune corresponds to, referenced to A=440 for scale
  // (Δf = 440 · (2^(cents/1200) − 1)). Just an indicative magnitude.
  const detuneHz = Math.round(440 * (Math.pow(2, detuneCents / 1200) - 1));
  const detuneHint =
    detuneCents === 0
      ? 'fine tune (relative)'
      : `≈ ${detuneHz > 0 ? '+' : ''}${detuneHz} Hz (from 440)`;

  return (
    <div className="pitch-control">
      {/* Pitch (semitones) */}
      <div className="slider-section">
        <div className="pitch-display">
          <div className="pitch-semitones">{semitoneLabel} semitones</div>
          <div className="pitch-note">{noteName}</div>
        </div>
        <input
          type="range"
          min="-6"
          max="6"
          step="1"
          value={currentPitch}
          onChange={(e) => onPitchChange(Number(e.target.value))}
          disabled={!isRunning}
          className="pitch-slider"
          aria-label="Pitch adjustment slider (semitones)"
        />
        <div className="slider-labels">
          <span>-6</span>
          <span>0</span>
          <span>+6</span>
        </div>
      </div>

      {/* Relative fine detune (cents) */}
      <div className="slider-section">
        <div className="pitch-display">
          <div className="pitch-semitones">{detuneLabel}</div>
          <div className="pitch-note">{detuneHint}</div>
        </div>
        <input
          type="range"
          min={-100}
          max={100}
          step={1}
          value={detuneCents}
          onChange={(e) => onDetuneChange(Number(e.target.value))}
          disabled={!isRunning}
          className="pitch-slider"
          aria-label="Relative fine detune in cents"
        />
        <div className="slider-labels">
          <span>-100</span>
          <span>0</span>
          <span>+100</span>
        </div>
      </div>
    </div>
  );
};

export default PitchControl;
