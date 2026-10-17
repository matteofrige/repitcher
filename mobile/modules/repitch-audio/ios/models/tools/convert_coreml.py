import sys, numpy as np, torch, coremltools as ct
from beat_this.inference import load_model
torch.set_num_threads(4)
class Wrap(torch.nn.Module):
    def __init__(s,m): super().__init__(); s.m=m
    def forward(s,spect):
        o=s.m(spect)
        return torch.sigmoid(o["beat"]), torch.sigmoid(o["downbeat"])
from beat_this.model import roformer
class StaticRotary(torch.nn.Module):
    """Same math as rotary_embedding_torch.rotate_queries_or_keys, with cos/sin precomputed for the fixed seq length."""
    def __init__(s,rot,n):
        super().__init__()
        with torch.no_grad():
            f=rot.forward(torch.arange(n).float())  # (n, rot_dim) interleaved-repeated freqs
        s.register_buffer("cos",f.cos()); s.register_buffer("sin",f.sin())
    def rotate_queries_or_keys(s,t):
        t2=t.unflatten(-1,(16,2))
        x1=t2[...,0]; x2=t2[...,1]
        rh=torch.stack((-x2,x1),dim=-1).flatten(-2)
        return t*s.cos+rh*s.sin
import torch.nn.functional as F
from beat_this.model import beat_tracker as bt
def attn_fwd(s,x):
    x=s.norm(x)
    B=s._B; N=s._N; H=s.heads
    qkv=s.to_qkv(x).reshape(B,N,3,H,32).permute(2,0,3,1,4)
    q,k,v=qkv[0],qkv[1],qkv[2]
    q=s.rotary_embed.rotate_queries_or_keys(q); k=s.rotary_embed.rotate_queries_or_keys(k)
    out=F.scaled_dot_product_attention(q,k,v)
    g=s.to_gates(x).permute(0,2,1).unsqueeze(-1).sigmoid()
    out=(out*g).permute(0,2,1,3).reshape(B,N,H*32)
    return s.to_out(out)
def pft_fwd(s,x):  # x: (1,C,F,T)
    _,C,Fq,T=x.shape
    x=x[0].permute(2,1,0)            # (T,F,C)
    x=x+s.attnF(x); x=x+s.ffF(x)
    x=x.permute(1,0,2)               # (F,T,C)
    x=x+s.attnT(x); x=x+s.ffT(x)
    return x.permute(2,0,1).unsqueeze(0)
def rms_fwd(s,x):
    # F.normalize(x)*scale*gamma, rescaled by max|x| first so the sum of squares cannot overflow in fp16
    m=x.abs().amax(dim=-1,keepdim=True).clamp(min=1e-4)
    y=x/m
    n=torch.sqrt((y*y).sum(dim=-1,keepdim=True)).clamp(min=1e-6)
    return (y/n)*s.scale*s.gamma
def fix_ops(model):
    for m in model.modules():
        if isinstance(m,roformer.RMSNorm): m.forward=rms_fwd.__get__(m)
        if isinstance(m,roformer.Attention): m.forward=attn_fwd.__get__(m)
        if isinstance(m,bt.PartialFTTransformer): m.forward=pft_fwd.__get__(m)
    st=model.frontend.stem
    st.rearrange_tf=torch.nn.Identity()  # replaced below via explicit permute modules
class Perm(torch.nn.Module):
    def __init__(s,*d): super().__init__(); s.d=d
    def forward(s,x): return x.permute(*s.d)
class Unsq(torch.nn.Module):
    def forward(s,x): return x.unsqueeze(1)
class Concat(torch.nn.Module):
    def forward(s,x):  # b c f t -> b t (c f)
        return x.permute(0,3,1,2).reshape(1,1500,256*4)
class Head2(torch.nn.Module):
    def __init__(s,h): super().__init__(); s.l=h.beat_downbeat_lin
    def forward(s,x):
        y=s.l(x); return {"beat":y[...,0]+y[...,1],"downbeat":y[...,1]}
def fix_all(model):
    fix_ops(model)
    model.frontend.stem.rearrange_tf=Perm(0,2,1)
    model.frontend.stem.add_channel=Unsq()
    model.frontend.concat=Concat()
    model.task_heads=Head2(model.task_heads)
def freeze_rotary(model,x):
    shapes={}
    hooks=[]
    for name,m in model.named_modules():
        if isinstance(m,roformer.Attention):
            hooks.append(m.register_forward_pre_hook(lambda mod,a,name=name: shapes.__setitem__(name,(a[0].shape[0],a[0].shape[-2]))))
    with torch.no_grad(): model(x)
    for h in hooks: h.remove()
    for name,m in model.named_modules():
        if isinstance(m,roformer.Attention):
            m._B,m._N=map(int,shapes[name]); m.rotary_embed=StaticRotary(m.rotary_embed,m._N)
SEL={
 # fp16 only for conv/linear (weight-bearing matmuls); everything else (norms, softmax, attention matmuls, residual adds) fp32
 "mixed1":lambda op: op.op_type in ("conv","linear"),
 # fp32 only for the attention core + norm reductions
 "mixed2":lambda op: op.op_type not in ("softmax","reduce_sum","reduce_mean","reduce_max","real_div","sqrt","matmul"),
}
def build(ckpt="final0",mode="fp16"):
    w=Wrap(load_model(ckpt)).eval()
    freeze_rotary(w.m,torch.randn(1,1500,128))
    fix_all(w.m)
    x=torch.randn(1,1500,128)
    with torch.no_grad(): tr=torch.jit.trace(w,x,check_trace=False)
    prec=ct.precision.FLOAT32 if mode=="fp32" else ct.transform.FP16ComputePrecision(op_selector=SEL[mode]) if mode in SEL else ct.precision.FLOAT16
    ml=ct.convert(tr,inputs=[ct.TensorType(name="spect",shape=(1,1500,128),dtype=np.float32)],
        outputs=[ct.TensorType(name="beat"),ct.TensorType(name="downbeat")],
        convert_to="mlprogram",minimum_deployment_target=ct.target.iOS17,
        compute_precision=prec,compute_units=ct.ComputeUnit.ALL)
    return ml
if __name__=="__main__":
    mode=sys.argv[1] if len(sys.argv)>1 else "fp16"; ml=build(mode=mode); ml.save(f"BeatThis_{mode}.mlpackage"); print("saved")
# Recommended variant = fp32 compute + int8 weights (fp16 compute is broken on GPU/ANE for this net):
#   python convert_coreml.py fp32 ; then variants.py (linear_symmetric int8 on BeatThis_fp32.mlpackage) -> BeatThis_fp32int8.mlpackage
