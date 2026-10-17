import sys,subprocess,time,numpy as np,torch,coremltools as ct
from beat_this.inference import Audio2Frames,split_piece,aggregate_prediction
sys.path.insert(0,'.')
D='/tmp/claude-501/beat-real/'
files={'tromba':'tromba','baroque':'the-mountain-royal-baroque','minuet':'minuet-a440'}
def F(ref,est,tol=0.07):
    used=set();tp=0
    for e in est:
        i=np.argmin(abs(ref-e))
        if abs(ref[i]-e)<=tol and i not in used: used.add(i);tp+=1
    p=tp/len(est);r=tp/len(ref);return 2*p*r/(p+r) if tp else 0
def hy(act,tag):
    fn=f'tmp-{tag}.f32'; act.astype('<f4').tofile(fn)
    r=subprocess.run(['./hybrid',fn,'50','36'],capture_output=True,text=True)
    return np.array([float(l) for l in r.stdout.split()]),r.stderr.strip()
a2f=Audio2Frames('final0','cpu')
specs={}
for k,f in files.items():
    x=np.fromfile(D+f+'.f32',dtype='<f4'); specs[k]=a2f.signal2spect(x,44100)
def cm_run(model,spect):
    chunks,starts=split_piece(spect,1500,border_size=6,avoid_short_end=True)
    pc=[]
    for c in chunks:
        o=model.predict({"spect":c.numpy().astype(np.float32)[None]})
        pc.append({"beat":torch.tensor(o["beat"][0]),"downbeat":torch.tensor(o["downbeat"][0])})
    b,d=aggregate_prediction(pc,starts,spect.shape[0],1500,6,"keep_first","cpu")
    return b.numpy(),d.numpy(),chunks
ref={k:(np.fromfile(f'act-final0-{k}-beat.f32',dtype='<f4'),np.fromfile(f'act-final0-{k}-down.f32',dtype='<f4')) for k in files}
refb={k:hy(ref[k][0],'ref'+k) for k in files}
for name in sys.argv[1:]:
    mdl=ct.models.MLModel(f"BeatThis_{name}.mlpackage",compute_units=ct.ComputeUnit.ALL)
    for k in files:
        b,d,chunks=cm_run(mdl,specs[k])
        rb,rd=ref[k]
        hb,st=hy(b,'cm'+k)
        print(f"{name:5s} {k:8s} beatMAD={np.abs(b-rb).mean():.5f} max={np.abs(b-rb).max():.4f} downMAD={np.abs(d-rd).mean():.5f} F={F(refb[k][0],hb):.4f} n={len(hb)}/{len(refb[k][0])} | {st}",flush=True)
    for cu in ['CPU_ONLY','ALL']:
        m2=ct.models.MLModel(f"BeatThis_{name}.mlpackage",compute_units=getattr(ct.ComputeUnit,cu))
        x={"spect":chunks[1].numpy().astype(np.float32)[None] if len(chunks)>1 else chunks[0].numpy()[None]}
        m2.predict(x); ts=[]
        for _ in range(5):
            t=time.time(); m2.predict(x); ts.append(time.time()-t)
        print(f"{name} {cu} per-chunk median {np.median(ts)*1000:.0f} ms (min {min(ts)*1000:.0f})",flush=True)
