package expo.modules.repitchaudio

/**
 * JNI surface of librepitchaudio.so (src/main/cpp/repitch_jni.cpp). A single object: the C++ symbols are
 * Java_expo_modules_repitchaudio_NativeBridge_<method>, so method names must stay in sync and must not
 * contain underscores. Members are public on purpose: `internal` would mangle the JVM names.
 *
 * Handles are raw native pointers (Long). The creator destroys them, never while another thread uses them.
 */
object NativeBridge {
  /** False if the .so is missing (unsupported ABI...): callers degrade instead of crashing the process. */
  @JvmField
  val available: Boolean = try {
    System.loadLibrary("repitchaudio")
    true
  } catch (t: Throwable) {
    false
  }

  // --- Signalsmith Stretch (pitch shifter) ---
  external fun stretchCreate(channels: Int, sampleRate: Int): Long
  external fun stretchSetPitch(handle: Long, semitones: Float)

  /** Interleaved in/out, exactly [frames] frames each. */
  external fun stretchProcess(handle: Long, input: FloatArray, output: FloatArray, frames: Int)
  external fun stretchReset(handle: Long)

  /** Stretcher delay (input + output latency) in frames. */
  external fun stretchLatency(handle: Long): Int
  external fun stretchDestroy(handle: Long)

  // --- TuningEstimator ---
  /** Returns [valid (1.0/0.0), refHz, cents, confidence]. */
  external fun tuningEstimate(samples: FloatArray, count: Int, sampleRate: Float): DoubleArray

  // --- MetronomeCore ---
  external fun metroCreate(): Long
  external fun metroPrepare(handle: Long, sampleRate: Double)
  external fun metroConfigure(handle: Long, bpm: Double, beatsPerBar: Int, volume: Double)
  external fun metroStart(handle: Long)
  external fun metroStop(handle: Long)

  /** Mono render of [frames] samples (<= 4096). Returns false for an all-silent block. */
  external fun metroRender(handle: Long, out: FloatArray, frames: Int): Boolean

  /** Pops up to out.size (max 64) events: (frameTime shl 8) or (accent ? 0x80 : 0) or beatIndex. Returns count. */
  external fun metroPopEvents(handle: Long, out: LongArray): Int
  external fun metroDestroy(handle: Long)

  // --- PitchDetector (+ history window and scope, like RPPitchDetectorBridge) ---
  external fun tunerCreate(sampleRate: Double): Long

  /** [count] <= 4096 mono samples. */
  external fun tunerProcess(handle: Long, samples: FloatArray, count: Int)

  /** Fills out (size >= 131) with [frequency, clarity, rms, wave x128]; returns the sequence number. */
  external fun tunerReading(handle: Long, out: FloatArray): Int
  external fun tunerReset(handle: Long)
  external fun tunerDestroy(handle: Long)

  // --- Beat detection (BeatThisFrontend / BeatThisChunking / BeatTracker; see beats_jni.cpp) ---
  // Result arrays: [valid, uncertain, bpm, confidence, downbeatIndex, downbeatMargin, beats...].
  external fun beatFrontendCreate(): Long
  external fun beatFrontendBegin(handle: Long, sampleRate: Double): Boolean
  external fun beatFrontendPush(handle: Long, samples: FloatArray, count: Int)

  /** Net handle (spectrogram + chunk layout), or 0 when the file is too short. */
  external fun beatFrontendFinish(handle: Long): Long
  external fun beatFrontendDestroy(handle: Long)
  external fun beatNetChunkCount(net: Long): Int
  external fun beatNetFrames(net: Long): Int

  /** Fills a DIRECT float buffer (>= 1500*128) with chunk [index]; returns the chunk length or -1. */
  external fun beatNetFill(net: Long, index: Int, dst: java.nio.ByteBuffer): Int
  external fun beatNetSetOutput(net: Long, index: Int, beat: FloatArray, down: FloatArray): Boolean

  /** Act handle (activations, 50 fps). */
  external fun beatNetStitch(net: Long): Long
  external fun beatNetDestroy(net: Long)
  external fun beatActCreate(data: FloatArray, frames: Int, fps: Float): Long
  external fun beatActData(act: Long): FloatArray?
  external fun beatActFrames(act: Long): Int
  external fun beatActFps(act: Long): Float
  external fun beatActAnalyze(act: Long, anchors: DoubleArray, beatsPerBar: Int): DoubleArray?
  external fun beatActDownbeatPhase(act: Long, beats: DoubleArray, beatsPerBar: Int): DoubleArray?
  external fun beatActDestroy(act: Long)
  external fun beatSpectralCreate(anchors: DoubleArray): Long
  external fun beatSpectralBegin(handle: Long, sampleRate: Double)
  external fun beatSpectralPush(handle: Long, samples: FloatArray, count: Int)
  external fun beatSpectralFinish(handle: Long): DoubleArray?
  external fun beatSpectralDestroy(handle: Long)

  // --- Beat follow mixer (clicks after the pitch shifter) ---
  external fun followCreate(): Long
  external fun followDestroy(handle: Long)
  external fun followPrepare(handle: Long, sampleRate: Double)
  external fun followSetBeats(handle: Long, beats: DoubleArray)
  external fun followConfigure(handle: Long, on: Boolean, audible: Boolean, beatsPerBar: Int, downbeat: Int, volume: Double)
  external fun followSegment(handle: Long, ptsSeconds: Double, latencyFrames: Int)

  /** Adds the clicks of the next [frames] output frames to [interleaved]. Playback thread. */
  external fun followMix(handle: Long, interleaved: FloatArray, frames: Int, channels: Int)
}
