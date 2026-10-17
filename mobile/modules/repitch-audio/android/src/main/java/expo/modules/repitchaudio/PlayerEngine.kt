@file:OptIn(UnstableApi::class)

package expo.modules.repitchaudio

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import java.io.File

/**
 * Module-side player logic, the Android counterpart of ios/PlayerEngine.swift. Drives the shared ExoPlayer
 * ([PlayerHolder]) and turns its callbacks into the events of index.ts with the same semantics as iOS:
 *  - onPlayingChange follows the *intent* to play (playWhenReady, not buffering blips while seeking);
 *  - onProgress every 250 ms while playing + immediately on seek / pause / end;
 *  - onPlayedSeconds = cumulative wall-clock seconds spent playing (never reset, like iOS);
 *  - onTrackEnd once per track, after a final progress / playedSeconds / playingChange(false).
 *
 * Main thread only. Construct on the main thread (it creates the ExoPlayer).
 */
class PlayerEngine(context: Context, private val emit: (String, Map<String, Any?>) -> Unit) {
  private val app = context.applicationContext
  private val main = Handler(Looper.getMainLooper())
  private val exo: ExoPlayer = PlayerHolder.player(app)

  private var playing = false
  private var endedHandled = false
  private var semitones = 0f

  private var playedSeconds = 0.0
  private var lastTickUptime = -1L

  private var pendingLoad: ((Result<Double>) -> Unit)? = null
  private var controllerFuture: ListenableFuture<MediaController>? = null

  private val tick = object : Runnable {
    override fun run() {
      if (!playing) return
      accruePlayedTime()
      emitProgress()
      emitPlayedSeconds()
      main.postDelayed(this, TICK_MS)
    }
  }

  private val listener = object : Player.Listener {
    override fun onPlaybackStateChanged(playbackState: Int) {
      when (playbackState) {
        Player.STATE_READY -> pendingLoad?.let {
          pendingLoad = null
          it(Result.success(durationSeconds()))
        }
        Player.STATE_ENDED -> if (playing) handleEnded()
      }
      syncPlaying()
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) = syncPlaying()

    override fun onPlaybackSuppressionReasonChanged(playbackSuppressionReason: Int) = syncPlaying()

    override fun onPlayerError(error: PlaybackException) {
      pendingLoad?.let {
        pendingLoad = null
        it(Result.failure(IllegalStateException(error.message ?: "Playback error")))
      }
      syncPlaying()
    }
  }

  init {
    exo.addListener(listener)
    PlayerHolder.onRemoteNext = { emit("onRemoteNext", emptyMap()) }
    PlayerHolder.onRemotePrevious = { emit("onRemotePrevious", emptyMap()) }
  }

  // --- Public API (main thread) ---

  fun load(uri: String, title: String?, done: (Result<Double>) -> Unit) {
    val parsed = Uri.parse(uri)
    val mediaUri = when (parsed.scheme) {
      null, "" -> Uri.fromFile(File(uri))
      "file", "content" -> parsed
      else -> {
        // iOS also only accepts local files.
        done(Result.failure(IllegalArgumentException("Invalid URL: $uri")))
        return
      }
    }
    ensureSessionService()

    pendingLoad?.invoke(Result.failure(IllegalStateException("Superseded by a newer load")))
    pendingLoad = null
    endedHandled = false

    val resolvedTitle = if (!title.isNullOrEmpty()) title else fileTitle(mediaUri)
    val item = MediaItem.Builder()
      .setUri(mediaUri)
      // Shown by the system media notification / lock screen.
      .setMediaMetadata(MediaMetadata.Builder().setTitle(resolvedTitle).build())
      .build()

    exo.playWhenReady = false  // a previous track stops (syncPlaying emits onPlayingChange(false))
    exo.setMediaItem(item)
    exo.prepare()
    pendingLoad = done  // resolved on STATE_READY, rejected on onPlayerError
  }

  fun play() {
    if (exo.mediaItemCount == 0) throw IllegalStateException("No track loaded")
    endedHandled = false
    when (exo.playbackState) {
      Player.STATE_ENDED -> exo.seekTo(0)  // restart after the end of the track (the flush resets the stretcher)
      Player.STATE_IDLE -> exo.prepare()
    }
    exo.play()
    syncPlaying()
  }

  fun pause() {
    exo.pause()
    syncPlaying()
  }

  fun seek(seconds: Double) {
    if (exo.mediaItemCount == 0) return
    val dur = exo.duration
    val maxMs = if (dur == C.TIME_UNSET || dur <= 0) Long.MAX_VALUE else dur
    val ms = (seconds * 1000.0).toLong().coerceIn(0L, maxMs)
    endedHandled = false
    exo.seekTo(ms)  // flush => PitchAudioProcessor resets the stretcher
    emitProgress()
  }

  fun setPitch(value: Double) {
    val v = value.coerceIn(-24.0, 24.0).toFloat()
    semitones = v
    PlayerHolder.processor.semitones = v  // picked up by the playback thread at the next buffer
  }

  fun status(): Map<String, Any?> = mapOf(
    "position" to positionSeconds(),
    "duration" to durationSeconds(),
    "isPlaying" to playing,
    "semitones" to semitones.toDouble()
  )

  fun release() {
    main.removeCallbacksAndMessages(null)
    pendingLoad = null
    exo.removeListener(listener)
    PlayerHolder.onRemoteNext = null
    PlayerHolder.onRemotePrevious = null
    exo.stop()
    exo.clearMediaItems()
    // Drop the controller first so the service can stop, then the player (which also drops the session).
    controllerFuture?.let { MediaController.releaseFuture(it) }
    controllerFuture = null
    PlayerHolder.release()
  }

  // --- State ---

  private fun positionSeconds(): Double =
    if (exo.mediaItemCount == 0) 0.0 else exo.currentPosition.coerceAtLeast(0L) / 1000.0

  private fun durationSeconds(): Double {
    val d = exo.duration
    return if (d == C.TIME_UNSET || d < 0) 0.0 else d / 1000.0
  }

  /** "Playing" as the UI understands it: wants to play and is not ended/idle/suppressed (focus loss). */
  private fun computePlaying(): Boolean =
    exo.playWhenReady &&
      (exo.playbackState == Player.STATE_READY || exo.playbackState == Player.STATE_BUFFERING) &&
      exo.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE

  /** Reconciles [playing] with ExoPlayer, starting/stopping the ticker and emitting onPlayingChange. */
  private fun syncPlaying() {
    val now = computePlaying()
    if (now == playing) return
    playing = now
    if (now) {
      lastTickUptime = SystemClock.uptimeMillis()
      main.removeCallbacks(tick)
      main.postDelayed(tick, TICK_MS)
    } else {
      accruePlayedTime()
      main.removeCallbacks(tick)
      emitProgress()  // iOS: pause emits the final position before the state change
    }
    emit("onPlayingChange", mapOf("isPlaying" to now))
  }

  /** End of track: once per track (iOS finishTrack). */
  private fun handleEnded() {
    if (endedHandled) return
    endedHandled = true
    accruePlayedTime()
    playing = false
    lastTickUptime = -1L
    main.removeCallbacks(tick)
    exo.playWhenReady = false  // so the next play() is a real false -> true transition
    emitProgress()
    emitPlayedSeconds()
    emit("onPlayingChange", mapOf("isPlaying" to false))
    emit("onTrackEnd", emptyMap())
  }

  private fun accruePlayedTime() {
    if (lastTickUptime < 0) return
    val now = SystemClock.uptimeMillis()
    playedSeconds += (now - lastTickUptime).coerceAtLeast(0L) / 1000.0
    lastTickUptime = if (playing) now else -1L
  }

  private fun emitProgress() {
    emit("onProgress", mapOf("position" to positionSeconds(), "duration" to durationSeconds()))
  }

  private fun emitPlayedSeconds() {
    emit("onPlayedSeconds", mapOf("seconds" to playedSeconds))
  }

  private fun fileTitle(uri: Uri): String {
    val name = uri.lastPathSegment ?: return ""
    val dot = name.lastIndexOf('.')
    return if (dot > 0) name.substring(0, dot) else name
  }

  /**
   * Binds the session service by opening a MediaController on its SessionToken. That is what makes Media3
   * create [PlaybackService], attach the notification and manage the foreground state. If it fails the
   * player still works, only without background notification.
   */
  private fun ensureSessionService() {
    if (controllerFuture != null) return
    try {
      val token = SessionToken(app, ComponentName(app, PlaybackService::class.java))
      controllerFuture = MediaController.Builder(app, token).buildAsync()
    } catch (e: Throwable) {
      controllerFuture = null
    }
  }

  private companion object {
    const val TICK_MS = 250L
  }
}
