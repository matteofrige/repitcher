"""Beat This! (final0) -> ONNX, FP32, fixed shapes. Usage: python export_onnx.py out.onnx
Reuses the wrapper/rewrites of ios/models/tools/convert_coreml.py (static rotary, fixed 1500 frames, sigmoid outputs).
Input `spect` float32 [1,1500,128]; outputs `beat`, `downbeat` float32 [1,1500] (after sigmoid)."""
import os, sys, torch
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "ios", "models", "tools"))
import convert_coreml as cc  # noqa: E402  (importing it needs coremltools installed; only the torch helpers are used)
from beat_this.inference import load_model  # noqa: E402

def main(out):
    w = cc.Wrap(load_model("final0")).eval()
    cc.freeze_rotary(w.m, torch.randn(1, 1500, 128))
    cc.fix_all(w.m)
    x = torch.randn(1, 1500, 128)
    with torch.no_grad():
        torch.onnx.export(w, (x,), out, input_names=["spect"], output_names=["beat", "downbeat"],
                          opset_version=17, dynamo=False, do_constant_folding=True)
    print("saved", out, os.path.getsize(out) // 1024, "KiB")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "BeatThis_fp32.onnx")
