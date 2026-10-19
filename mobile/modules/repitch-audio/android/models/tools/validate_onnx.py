"""Validate an ONNX Beat This! model against the PyTorch reference activations (like ios/models/tools/validate.py).
Usage (from the scratch dir that holds act-final0-*.f32 and the `hybrid` harness):  python validate_onnx.py model.onnx [threads]
Needs onnxruntime + beat_this. Reference: act-final0-{tromba,baroque,minuet}-{beat,down}.f32; test audio mono f32 @44100
in /tmp/claude-501/beat-real/. `hybrid` = cpp/beats harness: ./hybrid act.f32 50 36 -> beat times (HMM, lambda 36)."""
import sys, time, subprocess, numpy as np, torch, onnxruntime as ort
from beat_this.inference import Audio2Frames, split_piece, aggregate_prediction
D = '/tmp/claude-501/beat-real/'
files = {'tromba': 'tromba', 'baroque': 'the-mountain-royal-baroque', 'minuet': 'minuet-a440'}
def F(ref, est, tol=0.07):
    used = set(); tp = 0
    for e in est:
        i = np.argmin(abs(ref - e))
        if abs(ref[i] - e) <= tol and i not in used: used.add(i); tp += 1
    p = tp / len(est); r = tp / len(ref); return 2 * p * r / (p + r) if tp else 0
def hy(act, tag):
    fn = f'tmp-{tag}.f32'; act.astype('<f4').tofile(fn)
    r = subprocess.run(['./hybrid', fn, '50', '36'], capture_output=True, text=True)
    return np.array([float(l) for l in r.stdout.split()])
model, threads = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 4
so = ort.SessionOptions(); so.intra_op_num_threads = threads
sess = ort.InferenceSession(model, so, providers=['CPUExecutionProvider'])
a2f = Audio2Frames('final0', 'cpu')
for k, f in files.items():
    x = np.fromfile(D + f + '.f32', dtype='<f4'); spect = a2f.signal2spect(x, 44100)
    chunks, starts = split_piece(spect, 1500, border_size=6, avoid_short_end=True)
    pc = []; t0 = time.time()
    for c in chunks:
        inp = np.zeros((1, 1500, 128), np.float32); a = c.numpy(); inp[0, :len(a)] = a
        b, d = sess.run(None, {'spect': inp})
        pc.append({'beat': torch.tensor(b[0][:len(a)]), 'downbeat': torch.tensor(d[0][:len(a)])})
    dt = (time.time() - t0) / len(chunks)
    b, d = aggregate_prediction(pc, starts, spect.shape[0], 1500, 6, 'keep_first', 'cpu')
    b, d = b.numpy(), d.numpy()
    rb = np.fromfile(f'act-final0-{k}-beat.f32', dtype='<f4'); rd = np.fromfile(f'act-final0-{k}-down.f32', dtype='<f4')
    hr, hb = hy(rb, 'ref' + k), hy(b, 'ox' + k)
    print(f"{k:8s} beatMAD={np.abs(b-rb).mean():.5f} max={np.abs(b-rb).max():.4f} downMAD={np.abs(d-rd).mean():.5f} F={F(hr,hb):.4f} n={len(hb)}/{len(hr)} chunks={len(chunks)} {dt*1000:.0f} ms/chunk", flush=True)
