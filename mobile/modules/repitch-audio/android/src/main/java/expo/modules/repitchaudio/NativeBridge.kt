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
}
