# Beat This! -> ONNX (conversion tooling)

`../../src/main/assets/BeatThis.onnx` is the only model shipped on Android (copied to the app cache on first use and
run with onnxruntime-android, CPU). Same network as iOS (`final0`): input `spect` float32 [1,1500,128] (log-mel from
`cpp/beats/BeatThisFrontend.hpp`), outputs `beat`, `downbeat` float32 [1,1500] = sigmoid activations. opset 17, fixed shapes.

## FP16 warning
Never use FP16 compute: the network is numerically broken in FP16. Only the *weights* are int8 (weight-only,
dequantised to FP32 at run time), 81.8 MB FP32 -> 21.3 MB.

## Regenerate
1. venv with `torch`, `onnx`, `onnxscript`, `beat_this` (v1.1.0), `coremltools` (only because `export_onnx.py`
   imports the rewrites of `ios/models/tools/convert_coreml.py`), `numpy`, `onnxruntime` (validation only).
2. `python export_onnx.py BeatThis_fp32.onnx`
3. `python quantize_weights.py BeatThis_fp32.onnx BeatThis_int8.onnx`  (per-channel symmetric int8 on every MatMul/Conv
   weight >= 4096 elements + DequantizeLinear; plain onnx+numpy)
4. Copy to `../../src/main/assets/BeatThis.onnx` (never commit the FP32 file).
5. `python validate_onnx.py BeatThis_int8.onnx` from a scratch dir holding the reference activations
   `act-final0-*.f32` and the `hybrid` harness (see the docstring). Targets vs the PyTorch reference: beat MAD < ~0.005,
   beat-F (hybrid tracker) >= ~0.98.

Result (onnxruntime 1.31 desktop CPU, 4 threads, ~415 ms/chunk): tromba MAD 0.00089 F 1.000, baroque MAD 0.00320 F 1.000,
minuet MAD 0.00206 F 1.000 (137/137, 133/133, 100/100 beats).
