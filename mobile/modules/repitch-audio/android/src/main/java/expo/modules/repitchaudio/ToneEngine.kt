package expo.modules.repitchaudio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Process
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Reference tone for the tuner: Android counterpart of ios/ToneEngine.swift.
 *
 * A high-priority thread renders a phase-accumulator additive tone into its own low-latency mono float
 * AudioTrack. The main thread only writes the @Volatile targets; the thread smooths frequency (one-pole ~10 ms)
 * and gain (linear 20 ms in / 40 ms out), and once a requested stop has faded to silence it stops and
 * releases the track by itself. No allocation or locks in the render loop.
 */
class ToneEngine {
  @Volatile
  private var targetFreq = 440.0

  @Volatile
  private var targetGain = 0.0

  @Volatile
  private var stopRequested = false

  @Volatile
  private var thread: Thread? = null

  @Synchronized
  fun start(frequency: Double, volume: Double) {
    val freq = min(5000.0, max(20.0, frequency))
    val gain = MAX_GAIN * min(1.0, max(0.0, volume))
    if (thread?.isAlive == true) {
      targetFreq = freq
      targetGain = gain
      stopRequested = false
      return
    }

    val sampleRate = AudioTrack.getNativeOutputSampleRate(AudioManager.STREAM_MUSIC).let { if (it > 0) it else 48000 }
    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
      .build()
    val format = AudioFormat.Builder()
      .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
      .setSampleRate(sampleRate)
      .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
      .build()
    val minBytes = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT)
    check(minBytes > 0) { "AudioTrack does not support this configuration" }
    val builder = AudioTrack.Builder()
      .setAudioAttributes(attrs)
      .setAudioFormat(format)
      .setTransferMode(AudioTrack.MODE_STREAM)
      .setBufferSizeInBytes(max(minBytes, BLOCK_FRAMES * 4 * 2))
    if (Build.VERSION.SDK_INT >= 26) builder.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
    val track = builder.build()
    check(track.state == AudioTrack.STATE_INITIALIZED) { "AudioTrack not initialized" }

    targetFreq = freq
    targetGain = gain
    stopRequested = false
    val t = Thread({ renderLoop(track, sampleRate, freq) }, "RepitchTone")
    t.priority = Thread.MAX_PRIORITY
    thread = t
    t.start()
  }

  /** Fades out and lets the render thread stop and release the track. No-op if not playing. */
  fun stop() {
    if (thread?.isAlive != true) return
    targetGain = 0.0
    stopRequested = true
  }

  /** Stops immediately and waits (<= 500 ms) for the render thread. For OnDestroy. */
  fun release() {
    val t = thread ?: return
    targetGain = 0.0
    stopRequested = true
    try {
      t.join(500)
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
    }
  }

  private fun renderLoop(track: AudioTrack, sampleRate: Int, startFreq: Double) {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val sr = sampleRate.toDouble()
    val freqCoef = 1 - exp(-1 / (FREQ_SMOOTHING * sr))
    val upStep = MAX_GAIN / (FADE_IN * sr)
    val downStep = MAX_GAIN / (FADE_OUT * sr)
    val twoPi = 2 * PI
    val buf = FloatArray(BLOCK_FRAMES)
    var phase = 0.0
    var freq = startFreq
    var gain = 0.0
    try {
      track.play()
      while (true) {
        val tf = targetFreq
        val tg = targetGain
        for (i in 0 until BLOCK_FRAMES) {
          freq += (tf - freq) * freqCoef
          if (gain < tg) gain = min(tg, gain + upStep) else if (gain > tg) gain = max(tg, gain - downStep)
          val s = (sin(phase) + 0.5 * sin(2 * phase) + 0.3 * sin(3 * phase)) / 1.8
          buf[i] = (s * gain).toFloat()
          phase += twoPi * freq / sr
          if (phase >= twoPi) phase -= twoPi
        }
        // Blocking write: paces the loop to real time once the (small) buffer is full.
        val written = track.write(buf, 0, BLOCK_FRAMES, AudioTrack.WRITE_BLOCKING)
        if (written < 0) break
        if (stopRequested && gain <= SILENCE) {
          // Decide under the lock, so a start() racing with the exit either sees us alive (and the flag it
          // clears keeps us going) or sees no thread (and builds a new one).
          val done = synchronized(this) {
            if (stopRequested) {
              thread = null
              true
            } else {
              false
            }
          }
          if (done) break
        }
      }
    } catch (e: Throwable) {
      // Track died (device change...): the loop ends; the next toneStart rebuilds everything.
    } finally {
      synchronized(this) { if (thread === Thread.currentThread()) thread = null }
      try {
        track.pause()
        track.flush()
      } catch (e: Throwable) {
      }
      track.release()
    }
  }

  private companion object {
    const val BLOCK_FRAMES = 256
    const val MAX_GAIN = 0.98  // the waveform peaks below 1: no clipping
    const val FADE_IN = 0.020  // seconds
    const val FADE_OUT = 0.040
    const val FREQ_SMOOTHING = 0.010
    const val SILENCE = 1e-4
  }
}
