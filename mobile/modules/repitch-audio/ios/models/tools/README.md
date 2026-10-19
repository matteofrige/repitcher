# Beat This! -> Core ML (conversion tooling)

`../BeatThis.mlpackage` is the source model; `../BeatThis.mlmodelc` is its compiled form, the only
thing bundled in the app (pod resource bundle `RepitchAudioModels`, see `RepitchAudio.podspec`).

Model: input `spect` float32 [1,1500,128] (log-mel from `cpp/beats/BeatThisFrontend.hpp`), outputs
`beat` and `downbeat` float32 [1,1500] = sigmoid activations. mlprogram, iOS 17, FP32 compute with
int8 weights.

## FP16 warning
Never convert with FP16 compute precision (and never restrict to `.cpuAndNeuralEngine`): the network is
numerically broken in FP16 on GPU/ANE (activations collapse). The app uses `computeUnits = .all`
(ANE refuses FP32 and falls back to GPU/CPU) and retries with `.cpuOnly` if prediction throws.

## Regenerate
1. venv with: `torch`, `beat_this` (pip install from github.com/CPJKU/beat_this, v1.1.0), `coremltools` 9,
   `scikit-learn`, `numpy`. Checkpoints (`final0`, ...) are downloaded by beat_this from cloud.cp.jku.at.
2. `python convert_coreml.py fp32` -> `BeatThis_fp32.mlpackage`
3. `python variants.py` (linear_symmetric int8 weight quantisation on the fp32 package) -> `BeatThis_fp32int8.mlpackage`
4. Copy it to `../BeatThis.mlpackage`, then compile:
   `xcrun coremlcompiler compile ../BeatThis.mlpackage ..` -> `../BeatThis.mlmodelc` (commit both).
5. Validate: `python validate.py fp32int8` (needs reference activations `act-final0-*.f32` and test audio,
   see the paths at the top of the script). Targets vs the PyTorch reference: beat MAD < ~0.005,
   beat-F (hybrid tracker) >= ~0.98 on the three test tracks, per-chunk time ~ 100-300 ms.

The scripts were written to run from a scratch directory (relative paths, `/tmp` test audio): adjust paths as needed.
