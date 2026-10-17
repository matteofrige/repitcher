// Scripted demo for App Preview videos. Only triggered on iOS by the launch argument
// `-RePitchDemo <scene>` (see scripts/sim-video.sh); real users never set it.
import { setGlobalTuning } from './library';
import { setMetronome, startMetronome } from './metronome';
import { setCurrentOverride } from './player';
import { NEUTRAL_TUNING } from './tuning';

type Step = [delayMs: number, action: () => void];

// Runs the steps at absolute offsets (ms from now), driving the real app state.
function run(steps: Step[]) {
  for (const [delay, action] of steps) setTimeout(action, delay);
}

export function runDemo(scene: string) {
  switch (scene) {
    case 'tuning':
      // Start from a neutral tuning, then walk the reference A and the transposition.
      setGlobalTuning(NEUTRAL_TUNING);
      run([
        [1500, () => setGlobalTuning({ refHz: 442 })],
        [2700, () => setGlobalTuning({ refHz: 415 })],
        [3900, () => setGlobalTuning({ semitones: 1 })],
        [4500, () => setGlobalTuning({ semitones: 2 })],
        [5100, () => setGlobalTuning({ semitones: 3 })],
      ]);
      break;
    case 'player':
      // The route itself starts the track; nudge its own transposition after a while.
      run([[2500, () => setCurrentOverride({ semitones: 4 })]]);
      break;
    case 'metronome':
      setMetronome({ bpm: 96 });
      run([[800, () => void startMetronome()]]);
      break;
    default:
      // 'library' and unknown scenes: static.
      break;
  }
}
