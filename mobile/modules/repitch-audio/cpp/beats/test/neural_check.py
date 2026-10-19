#!/usr/bin/env python
"""Verifica BeatThisFrontend.hpp + analyzeActivation contro beat_this (PyTorch).

Uso (venv con torch + beat_this + soxr):
  <venv>/bin/python neural_check.py [--bin PATH/neural_check] [--audio DIR] [--eval DIR] [--out DIR]
    --audio  cartella con {tromba,the-mountain-royal-baroque,minuet-a440}.f32 (mono float32 44.1 kHz)
    --eval   cartella con hy-final0-*-beats.txt (riferimento ibrido della valutazione), opzionale
Compilare prima: clang++ -std=c++17 -O2 neural_check.cpp -o neural_check
"""
import argparse, os, subprocess, sys, tempfile
import numpy as np, soxr, torch
from beat_this.inference import Audio2Frames, split_piece, aggregate_prediction

ap = argparse.ArgumentParser()
ap.add_argument('--bin', default=os.path.join(os.environ.get('TMPDIR', '/tmp'), 'nc', 'neural_check'))
ap.add_argument('--audio', default='/tmp/claude-501/beat-real')
ap.add_argument('--eval', default='')
ap.add_argument('--out', default=tempfile.mkdtemp(prefix='nc-'))
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
FILES = {'tromba': 'tromba', 'baroque': 'the-mountain-royal-baroque', 'minuet': 'minuet-a440'}
fails = 0

def sh(*args):
    return subprocess.run([a.bin, *map(str, args)], capture_output=True, text=True, check=True).stdout

def F(ref, est, tol=0.07):
    ref = np.asarray(ref); est = np.asarray(est); used = set(); tp = 0
    for e in est:
        i = int(np.argmin(abs(ref - e)))
        if abs(ref[i] - e) <= tol and i not in used: used.add(i); tp += 1
    if not tp: return 0.0
    p = tp / len(est); r = tp / len(ref); return 2 * p * r / (p + r)

def cmp(c, t):
    n = min(len(c), len(t))
    d = np.abs(c[:n] - t[:n])
    return len(c), len(t), d.max(), d.mean(), np.corrcoef(c[:n].ravel(), t[:n].ravel())[0, 1]

# ---- 1. chunking / stitch contro beat_this ----
print('== chunking / stitch')
rng = np.random.default_rng(0)
for N in [1, 5, 100, 1487, 1488, 1489, 1494, 1500, 1501, 2976, 3000, 7750, 15000]:
    ch, st = split_piece(torch.zeros(N, 128), 1500, 6, True)
    cc = [list(map(int, l.split())) for l in sh('chunks', N).splitlines()]
    ok = len(cc) == len(st) and all(c[0] == s for c, s in zip(cc, st)) and all(
        c[3] + (c[2] - c[1]) + c[4] == len(x) for c, x in zip(cc, ch))
    # contenuto del chunk: stessa regione reale e stesso padding
    outs = [rng.standard_normal(len(x)).astype('f4') for x in ch]
    ref_b, _ = aggregate_prediction([{'beat': torch.tensor(o), 'downbeat': torch.tensor(o)} for o in outs], list(st), N, 1500, 6, 'keep_first', 'cpu')
    np.concatenate(outs).tofile(f'{a.out}/st-in.f32')
    sh('stitch', N, f'{a.out}/st-in.f32', f'{a.out}/st-out.f32')
    mine = np.fromfile(f'{a.out}/st-out.f32', 'f4')
    ok = ok and len(mine) == N and np.array_equal(mine, ref_b.numpy())
    if not ok: fails += 1
    print(f'  N={N:6d} chunks={len(cc):3d} {"PASS" if ok else "FAIL"}')

# ---- 2. spettrogramma + attivazioni ----
m = Audio2Frames(checkpoint_path='final0', device='cpu')
torch.set_num_threads(4)
for k, f in FILES.items():
    print(f'== {k}')
    x = np.fromfile(f'{a.audio}/{f}.f32', '<f4')
    ref = m.signal2spect(x, 44100).numpy()
    sh_out = sh('spec', f'{a.audio}/{f}.f32', 44100, f'{a.out}/{k}-spec.f32')
    c = np.fromfile(f'{a.out}/{k}-spec.f32', 'f4').reshape(-1, 128)
    nc, nt, mx, mean, cor = cmp(c, ref)
    print(f'  spec 44.1k (resample C++ vs soxr): frames {nc}/{nt} max={mx:.4f} mean={mean:.5f} corr={cor:.6f}  [{sh_out.strip()}]')
    if not (nc == nt and mean < 0.02 and cor > 0.999): fails += 1; print('  FAIL spec')
    # isolamento STFT/mel: stesso segnale a 22050 (soxr) a entrambi
    x22 = soxr.resample(x, 44100, 22050).astype('f4')
    x22.tofile(f'{a.out}/{k}-22k.f32')
    sh('spec', f'{a.out}/{k}-22k.f32', 22050, f'{a.out}/{k}-spec22.f32')
    c22 = np.fromfile(f'{a.out}/{k}-spec22.f32', 'f4').reshape(-1, 128)
    ref22 = m.spect(torch.tensor(x22)).numpy()
    nc, nt, mx, mean, cor = cmp(c22, ref22)
    print(f'  spec 22.05k (solo STFT/mel):        frames {nc}/{nt} max={mx:.6f} mean={mean:.7f} corr={cor:.8f}')
    if not (nc == nt and mx < 1e-3): fails += 1; print('  FAIL stft/mel')
    # altri sr: 48k e 32k (solo errore spettrale, riferimento = soxr)
    for sr2 in (48000, 32000):
        xs = soxr.resample(x, 44100, sr2).astype('f4'); xs.tofile(f'{a.out}/{k}-{sr2}.f32')
        sh('spec', f'{a.out}/{k}-{sr2}.f32', sr2, f'{a.out}/{k}-spec{sr2}.f32')
        cs = np.fromfile(f'{a.out}/{k}-spec{sr2}.f32', 'f4').reshape(-1, 128)
        rs = m.signal2spect(xs, sr2).numpy()
        nc, nt, mx, mean, cor = cmp(cs, rs)
        print(f'  spec {sr2}: frames {nc}/{nt} max={mx:.4f} mean={mean:.5f} corr={cor:.6f}')
        if not (nc == nt and mean < 0.02 and cor > 0.999): fails += 1; print('  FAIL spec', sr2)
    # rete sullo spettrogramma C++
    with torch.inference_mode():
        lb, ld = m.spect2frames(torch.tensor(c))
    pb = torch.sigmoid(lb).numpy().astype('<f4'); pd = torch.sigmoid(ld).numpy().astype('<f4')
    pb.tofile(f'{a.out}/{k}-beat.f32'); pd.tofile(f'{a.out}/{k}-down.f32')
    print('  ', sh('act', f'{a.out}/{k}-beat.f32', f'{a.out}/{k}-down.f32', 50, f'{a.out}/{k}-beats.txt').strip())
    mine = np.loadtxt(f'{a.out}/{k}-beats.txt')
    if a.eval:
        hy = np.loadtxt(f'{a.eval}/hy-final0-{k}-beats.txt')
        Fv = F(hy, mine)
        print(f'  F(C++ spec -> net -> analyzeActivation vs evaluation hybrid) = {Fv:.4f}  (n {len(mine)}/{len(hy)})')
        if Fv < 0.98: fails += 1; print('  FAIL F')
        # anche: attivazioni di beat_this originali (spettrogramma Python) nello stesso decoder
        ap_ = f'{a.eval}/act-final0-{k}-beat.f32'
        if os.path.exists(ap_):
            print('  python-act:', sh('act', ap_, f'{a.eval}/act-final0-{k}-down.f32', 50, f'{a.out}/{k}-beats-py.txt').strip())
        # differenza attivazioni
        if os.path.exists(ap_):
            pa = np.fromfile(ap_, '<f4'); n = min(len(pa), len(pb))
            print(f'  act diff vs python spec: max={np.abs(pa[:n]-pb[:n]).max():.3f} mean={np.abs(pa[:n]-pb[:n]).mean():.5f}')
print('fails =', fails)
sys.exit(1 if fails else 0)
