import coremltools as ct, coremltools.optimize.coreml as cto
m=ct.models.MLModel("BeatThis_fp32.mlpackage")
cto.linear_quantize_weights(m,cto.OptimizationConfig(global_config=cto.OpLinearQuantizerConfig(mode="linear_symmetric",dtype="int8"))).save("BeatThis_fp32int8.mlpackage")
cto.palettize_weights(m,cto.OptimizationConfig(global_config=cto.OpPalettizerConfig(mode="kmeans",nbits=6))).save("BeatThis_fp32pal6.mlpackage")
