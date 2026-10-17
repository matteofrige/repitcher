package expo.modules.repitchaudio

import android.content.Context
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Process
import android.os.SystemClock
import kotlin.math.max

/**
 * Tuner input: Android counterpart of ios/TunerEngine.swift + RPPitchDetectorBridge.mm.
 *
 * An AudioRecord (mono float) feeds the C++ PitchDetector through the JNI port of RPPitchDetectorBridge (history
 * window, detection every ~1024 new samples, 128-point scope). The reader thread reports the latest reading to
 * JS at most every 33 ms (30 Hz like iOS) and only when a new detection exists.
 *
 * The RECORD_AUDIO permission is checked / requested by the caller (RepitchAudioModule); this class only
 * records. A missing permission surfaces as SecurityException / uninitialised AudioRecord.
 * stop() releases the microphone immediately.
 */
class TunerEngine(private val onReading: (Map<String, Any?>) -> Unit) {
  @Volatile
  private var running = false

  @Volatile
  private var thread: Thread? = null

  val isRunning: Boolean get() = running

  /** @throws SecurityException when the mic permission is missing, IllegalStateException on other failures. */
  @Synchronized
  fun start(context: Context) {
    if (running) return
    check(NativeBridge.available) { "Native library not loaded" }

    // UNPROCESSED is the closest thing to iOS' .measurement mode (no AGC / noise suppression / echo cancel).
    val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val unprocessed = audioManager.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true"
    val source = if (unprocessed) MediaRecorder.AudioSource.UNPROCESSED else MediaRecorder.AudioSource.VOICE_RECOGNITION

    var record: AudioRecord? = null
    var sampleRate = 0
    for (rate in intArrayOf(48000, 44100)) {
      val minBytes = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
      if (minBytes <= 0) continue
      val candidate = AudioRecord(
        source,
        rate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_FLOAT,
        max(minBytes, BLOCK_FRAMES * 4 * 4)
      )
      if (candidate.state == AudioRecord.STATE_INITIALIZED) {
        record = candidate
        sampleRate = rate
        break
      }
      candidate.release()
    }
    val rec = record ?: throw IllegalStateException("No audio input available")

    val detector = NativeBridge.tunerCreate(sampleRate.toDouble())
    try {
      rec.startRecording()
      check(rec.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Unable to start recording" }
    } catch (t: Throwable) {
      rec.release()
      NativeBridge.tunerDestroy(detector)
      throw t
    }

    running = true
    val t = Thread({ readLoop(rec, detector) }, "RepitchTuner")
    thread = t
    t.start()
  }

  @Synchronized
  fun stop() {
    if (!running && thread == null) return
    running = false
    thread?.let {
      try {
        it.join(1000)
      } catch (e: InterruptedException) {
        Thread.currentThread().interrupt()
      }
    }
    thread = null
  }

  private fun readLoop(rec: AudioRecord, detector: Long) {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val buf = FloatArray(BLOCK_FRAMES)
    val reading = FloatArray(3 + WAVE_POINTS)
    var lastSeq = -1
    var lastEmit = 0L
    try {
      while (running) {
        val n = rec.read(buf, 0, BLOCK_FRAMES, AudioRecord.READ_BLOCKING)
        if (n < 0) break
        if (n > 0) NativeBridge.tunerProcess(detector, buf, n)

        val now = SystemClock.uptimeMillis()
        if (now - lastEmit >= EMIT_INTERVAL_MS) {
          val seq = NativeBridge.tunerReading(detector, reading)
          if (seq != lastSeq) {  // nothing new since the last tick otherwise
            lastSeq = seq
            lastEmit = now
            val wave = ArrayList<Double>(WAVE_POINTS)
            for (i in 0 until WAVE_POINTS) wave.add(reading[3 + i].toDouble())
            onReading(
              mapOf(
                "frequency" to reading[0].toDouble(),
                "clarity" to reading[1].toDouble(),
                "rms" to reading[2].toDouble(),
                "wave" to wave
              )
            )
          }
        }
      }
    } catch (e: Throwable) {
      // Input lost: the loop ends and the mic is released below.
    } finally {
      running = false
      try {
        rec.stop()
      } catch (e: Throwable) {
      }
      rec.release()
      NativeBridge.tunerDestroy(detector)
    }
  }

  private companion object {
    const val BLOCK_FRAMES = 1024
    const val WAVE_POINTS = 128
    const val EMIT_INTERVAL_MS = 33L
  }
}
