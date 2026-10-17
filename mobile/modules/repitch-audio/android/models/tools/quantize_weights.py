"""Weight-only int8 quantisation of a FP32 ONNX model (compute stays FP32; FP16 is numerically broken for this net).
Usage: python quantize_weights.py in.onnx out.onnx
Every MatMul/Conv weight initializer (>= 4096 elements) becomes int8 (symmetric, per output channel) + a
DequantizeLinear node that feeds the original consumer. Identical large initializers (the per-layer rotary tables)
are stored once. Plain onnx + numpy (no onnxruntime needed; ORT's MatMulNBits is 4-bit oriented and dynamic
quantisation would also quantise activations).
"""
import sys, hashlib, numpy as np, onnx
from onnx import numpy_helper as nh, helper, TensorProto

def main(src, dst):
    m = onnx.load(src)
    g = m.graph
    # 1) dedupe identical big initializers
    seen, rename = {}, {}
    for t in list(g.initializer):
        a = nh.to_array(t)
        if a.size < 4096: continue
        h = hashlib.sha1(a.tobytes() + str(a.shape).encode()).hexdigest()
        if h in seen: rename[t.name] = seen[h]
        else: seen[h] = t.name
    if rename:
        for n in g.node:
            for i, x in enumerate(n.input):
                if x in rename: n.input[i] = rename[x]
        keep = [t for t in g.initializer if t.name not in rename]
        del g.initializer[:]; g.initializer.extend(keep)
    init = {t.name: t for t in g.initializer}
    # 2) quantise weights of MatMul (input 1) and Conv (input 1)
    new_nodes, done = [], {}
    for n in g.node:
        if n.op_type in ("MatMul", "Conv") and len(n.input) > 1 and n.input[1] in init:
            name = n.input[1]; w = nh.to_array(init[name]).astype(np.float32)
            if w.size >= 4096 and w.ndim >= 2:
                if name not in done:
                    axis = 1 if n.op_type == "MatMul" else 0
                    red = tuple(i for i in range(w.ndim) if i != axis)
                    scale = np.maximum(np.abs(w).max(axis=red), 1e-12) / 127.0
                    shp = [1] * w.ndim; shp[axis] = -1
                    q = np.clip(np.round(w / scale.reshape(shp)), -127, 127).astype(np.int8)
                    qn, sn, dn = name + "_q8", name + "_scale", name + "_dq"
                    g.initializer.append(nh.from_array(q, qn))
                    g.initializer.append(nh.from_array(scale.astype(np.float32), sn))
                    new_nodes.append(helper.make_node("DequantizeLinear", [qn, sn], [dn], axis=axis, name=name + "_deq"))
                    done[name] = dn
                n.input[1] = done[name]
    keep = [t for t in g.initializer if t.name not in done]
    del g.initializer[:]; g.initializer.extend(keep)
    nodes = list(g.node); del g.node[:]
    g.node.extend(new_nodes + nodes)  # DequantizeLinear nodes only read initializers: they can go first
    onnx.checker.check_model(m)
    onnx.save(m, dst)
    print("quantised", len(done), "weights; deduped", len(rename), "->", dst)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
