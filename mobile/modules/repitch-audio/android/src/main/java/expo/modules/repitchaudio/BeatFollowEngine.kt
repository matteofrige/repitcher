package expo.modules.repitchaudio

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import kotlin.math.abs

/**
 * Metronome on the beats of the loaded track: Android counterpart of the follow part of ios/MetronomeEngine.swift.
 *
 *  - Audio: the clicks are mixed natively inside [PitchAudioProcessor] (after the pitch shift, sample-accurate from the
 *    file position of the processor's input frames). This class only hands it the beats/options.
 *  - Events: an ~8 ms pump looks 0.35 s ahead of the audible file position and emits `onMetronomeBeat` (follow = true)
 *    at that moment, with `atMs` = epoch ms (JS Date.now() clock) at which the beat is heard, so JS has ~300 ms of
 *    lead for the flash. Pause / seek / track change reset the cursor (nothing is emitted while paused).
 *
 * Main thread only.
 */
class BeatFollowEngine(
  private val player: PlayerEngine,
  private val onBeat: (beat: Int, accent: Boolean, atMs: Double) -> Unit
) {
  private val main = Handler(Looper.getMainLooper())
  private val processor = PlayerHolder.processor

  var isFollowing = false
    private set

  private var beats = DoubleArray(0)
  private var beatsPerBar = 4
  private var downbeat = 0
  private var clickAudible = true
  private var volume = 0.8

  private var nextBeat = 0
  private var cursorValid = false
  private var lastPos = 0.0
  private var lastUptime = 0L

  private val pump = object : Runnable {
    override fun run() {
      if (!isFollowing) return
      tick()
      main.postDelayed(this, PUMP_MS)
    }
  }

  fun start(beats: DoubleArray, beatsPerBar: Int, downbeatIndex: Int, clickAudible: Boolean, volume: Double) {
    this.beats = beats
    this.beatsPerBar = maxOf(1, beatsPerBar)
    this.downbeat = maxOf(0, downbeatIndex)
    this.clickAudible = clickAudible
    this.volume = volume
    processor.setFollowBeats(beats)
    processor.configureFollow(true, clickAudible, this.beatsPerBar, downbeat, volume)
    cursorValid = false  // new beats (e.g. track change) on a running follow: just resync
    if (!isFollowing) {
      isFollowing = true
      main.removeCallbacks(pump)
      main.post(pump)
    }
  }

  fun updateOptions(clickAudible: Boolean, beatsPerBar: Int, downbeatIndex: Int, volume: Double) {
    this.clickAudible = clickAudible
    this.beatsPerBar = maxOf(1, beatsPerBar)
    this.downbeat = maxOf(0, downbeatIndex)
    this.volume = volume
    if (isFollowing) processor.configureFollow(true, clickAudible, this.beatsPerBar, downbeat, volume)
  }

  fun stop() {
    if (!isFollowing) return
    isFollowing = false
    main.removeCallbacks(pump)
    processor.configureFollow(false, true, beatsPerBar, downbeat, volume)
    processor.setFollowBeats(DoubleArray(0))
    beats = DoubleArray(0)
    cursorValid = false
  }

  private fun firstBeat(t: Double): Int {
    var lo = 0
    var hi = beats.size
    while (lo < hi) {
      val mid = (lo + hi) ushr 1
      if (beats[mid] < t) lo = mid + 1 else hi = mid
    }
    return lo
  }

  private fun tick() {
    val pos = player.audibleSeconds()
    if (pos == null) {  // paused / ended / buffering
      cursorValid = false
      return
    }
    val up = SystemClock.uptimeMillis()
    val wallMs = System.currentTimeMillis()
    var resync = !cursorValid
    var jump = 0.0
    if (!resync) {
      val expected = lastPos + (up - lastUptime) / 1000.0
      jump = pos - expected
      if (abs(jump) > JUMP_TOLERANCE) resync = true
    }
    lastPos = pos
    lastUptime = up
    if (resync) {
      val emitted = nextBeat
      nextBeat = firstBeat(pos - LATE_TOLERANCE)
      // A small hiccup of the clock must not re-flash beats already emitted; a real seek (or first sync) restarts.
      if (cursorValid && abs(jump) < 0.3 && nextBeat < emitted) nextBeat = emitted
      cursorValid = true
    }
    while (nextBeat < beats.size) {
      val i = nextBeat
      val dt = beats[i] - pos
      if (dt > LOOK_AHEAD) break
      if (dt < -LATE_TOLERANCE) {
        nextBeat++
        continue
      }
      val inBar = ((i - downbeat) % beatsPerBar + beatsPerBar) % beatsPerBar
      nextBeat++
      onBeat(inBar, inBar == 0, wallMs + dt * 1000.0)
    }
  }

  private companion object {
    const val PUMP_MS = 8L
    const val LOOK_AHEAD = 0.35
    const val LATE_TOLERANCE = 0.02
    const val JUMP_TOLERANCE = 0.05
  }
}
