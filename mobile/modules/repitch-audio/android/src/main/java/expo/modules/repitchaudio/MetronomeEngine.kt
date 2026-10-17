package expo.modules.repitchaudio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTimestamp
import android.media.AudioTrack
import android.os.Build
import android.os.Process
import kotlin.math.max

/**
 * Click track: Android counterpart of ios/MetronomeEngine.swift + RPMetronome.mm.
 *
 * A dedicated high-priority thread renders the C++ MetronomeCore in small blocks into its own low-latency
 * AudioTrack (mono float, at the device's native output rate => no resampling in the click path). It is a
 * separate track from the ExoPlayer one, so the system mixer plays click and music together and pausing one
 * never stops the other (like iOS' shared mixer).
 *
 * Timing lives entirely in the core (frame counting). The thread only *reports* beats: each core event
 * carries the absolute frame at which the click starts; it is emitted right away (as early as it is known)
 * together with `atMs`, the epoch time (JS `Date.now()` clock) at which that frame leaves the speaker, derived
 * from AudioTrack.getTimestamp (falling back to the playback head). JS schedules the visuals on that time.
 * Events are emitted from this thread (sendEvent is thread-safe).
 */
class MetronomeEngine(private val onBeat: (beat: Int, accent: Boolean, atMs: Double) -> Unit) {
  private val handle: Long = if (NativeBridge.available) NativeBridge.metroCreate() else 0L

  @Volatile
  private var thread: Thread? = null

  @Volatile
  private var running = false

  val isActive: Boolean get() = running

  init {
    if (handle != 0L) NativeBridge.metroConfigure(handle, 100.0, 4, 0.8)  // same defaults as iOS
  }

  /** Atomics in the core: valid while running too (BPM changes never skip a beat). */
  fun configure(bpm: Double, beatsPerBar: Int, volume: Double) {
    if (handle != 0L) NativeBridge.metroConfigure(handle, bpm, beatsPerBar, volume)
  }

  @Synchronized
  fun start() {
    if (running) return
    check(handle != 0L) { "Native library not loaded" }
    // A previous render thread that outlived stop()'s join must be gone before the core is re-prepared.
    thread?.let {
      if (it.isAlive) it.join(2000)
      check(!it.isAlive) { "Metronome output is stalled" }
      thread = null
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

    // Order matters: prepare() resets the absolute frame counter, which must start at 0 together with the
    // new track's playback head; the render thread is not running yet.
    NativeBridge.metroPrepare(handle, sampleRate.toDouble())
    NativeBridge.metroStart(handle)
    running = true
    val t = Thread({ renderLoop(track, sampleRate) }, "RepitchMetronome")
    t.priority = Thread.MAX_PRIORITY
    thread = t
    t.start()
  }

  @Synchronized
  fun stop() {
    if (!running && thread == null) return
    running = false
    if (handle != 0L) NativeBridge.metroStop(handle)  // immediate silence even before the thread exits
    thread?.let {
      try {
        it.join(500)
      } catch (e: InterruptedException) {
        Thread.currentThread().interrupt()
      }
      // Still alive (blocked in AudioTrack.write on a stalled device): keep the reference, so start() waits for
      // it and release() does not free the core under a thread that may still call metroRender.
      if (it.isAlive) return
    }
    thread = null
  }

  /** Stops and frees the native core. Call once. */
  fun release() {
    stop()
    if (thread != null) return  // render thread stalled: leaking the core is safer than a use-after-free
    if (handle != 0L) NativeBridge.metroDestroy(handle)
  }

  private fun renderLoop(track: AudioTrack, sampleRate: Int) {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val buf = FloatArray(BLOCK_FRAMES)
    val events = LongArray(32)
    val ts = AudioTimestamp()
    try {
      track.play()
      while (running) {
        NativeBridge.metroRender(handle, buf, BLOCK_FRAMES)
        // Blocking write: paces the loop to real time once the (small) buffer is full.
        val written = track.write(buf, 0, BLOCK_FRAMES, AudioTrack.WRITE_BLOCKING)
        if (written < 0) break

        val n = NativeBridge.metroPopEvents(handle, events)
        if (n > 0) {
          val clock = HeardClock(track, ts, sampleRate)
          for (i in 0 until n) {
            val atMs = clock.epochMsOf(events[i] shr 8)
            // Drop stale beats (> 1 s in the past) instead of bursting them.
            if (atMs < System.currentTimeMillis() - 1000) continue
            onBeat((events[i] and 0x7F).toInt(), (events[i] and 0x80) != 0L, atMs)
          }
        }
      }
    } catch (e: Throwable) {
      // Track died (device change...): the loop ends; the next metronomeStart rebuilds everything.
    } finally {
      running = false
      try {
        track.pause()
        track.flush()
      } catch (e: Throwable) {
      }
      track.release()
    }
  }

  /** Maps an absolute core frame to the epoch ms at which it is heard (hardware timestamp, else playback head). */
  private class HeardClock(track: AudioTrack, ts: AudioTimestamp, private val sampleRate: Int) {
    private val hasTs = track.getTimestamp(ts)
    private val tsNanos = ts.nanoTime
    private val tsFrame = ts.framePosition
    private val head = track.playbackHeadPosition.toLong() and 0xFFFFFFFFL  // unsigned 32-bit
    private val nowNanos = System.nanoTime()
    private val nowMs = System.currentTimeMillis()

    fun epochMsOf(frame: Long): Double {
      if (hasTs) {
        val heardNanos = tsNanos + (frame - tsFrame) * 1_000_000_000L / sampleRate
        return nowMs + (heardNanos - nowNanos) / 1e6
      }
      return nowMs + (frame - head) * 1000.0 / sampleRate
    }
  }

  private companion object {
    const val BLOCK_FRAMES = 256
  }
}
