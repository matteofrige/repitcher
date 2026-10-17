@file:OptIn(UnstableApi::class)

package expo.modules.repitchaudio

import android.content.Context
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink

/**
 * Process-wide owner of the ONE ExoPlayer, shared by the Expo module (JS API) and [PlaybackService]
 * (media session / notification / lock screen). Both live in the app process, so a plain singleton is enough.
 *
 * Main thread only for everything that touches the player (ExoPlayer's application looper is the main one).
 *
 * Media3 session pattern used (simplest robust one):
 *  - the SERVICE owns the MediaSession (created in onCreate, released in onDestroy) wrapping [sessionPlayer];
 *  - the MODULE binds the service by building a MediaController on its SessionToken (see PlayerEngine), and
 *    drives the raw ExoPlayer directly. Media3 then shows the media notification, promotes the service to the
 *    foreground when playback starts and demotes it when it stops, without any manual startForegroundService.
 */
object PlayerHolder {
  /** Pitch shifter inserted in the audio sink. Survives player re-creation, so the setting is never lost. */
  val processor = PitchAudioProcessor()

  /** Called (main thread) when the notification / lock screen / headset asks for the next/previous track. */
  @Volatile
  var onRemoteNext: (() -> Unit)? = null

  @Volatile
  var onRemotePrevious: (() -> Unit)? = null

  private var player: ExoPlayer? = null
  private var forwarding: Player? = null

  /** The shared player; created lazily with the application context. Main thread. */
  fun player(context: Context): ExoPlayer {
    player?.let { return it }
    val app = context.applicationContext
    val created = ExoPlayer.Builder(app, PitchRenderersFactory(app, processor))
      // Audio focus + ducking + pause on focus loss, all handled by ExoPlayer.
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(C.USAGE_MEDIA)
          .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
          .build(),
        /* handleAudioFocus = */ true
      )
      // Headphones unplugged / BT disconnected -> pause (iOS: routeChange oldDeviceUnavailable).
      .setHandleAudioBecomingNoisy(true)
      // Local files: keep the CPU awake while playing with the screen off (needs WAKE_LOCK).
      .setWakeMode(C.WAKE_MODE_LOCAL)
      .build()
    player = created
    forwarding = RemoteButtonsPlayer(created)
    return created
  }

  /** The Player the MediaSession wraps (see [RemoteButtonsPlayer]). */
  fun sessionPlayer(context: Context): Player {
    player(context)
    return forwarding!!
  }

  /** Releases the ExoPlayer (module destroyed, e.g. JS reload). The service must drop its session first. */
  fun release() {
    PlaybackService.instance?.releaseSession()  // the session must not outlive the player it wraps
    player?.release()
    player = null
    forwarding = null
  }

  /** DefaultRenderersFactory whose audio sink runs [PitchAudioProcessor]. */
  private class PitchRenderersFactory(context: Context, private val processor: AudioProcessor) :
    DefaultRenderersFactory(context) {
    override fun buildAudioSink(
      context: Context,
      enableFloatOutput: Boolean,
      enableAudioOutputPlaybackParams: Boolean
    ): AudioSink? {
      // The processor converts any PCM input to float itself, so the float-output flags are not needed.
      return DefaultAudioSink.Builder(context)
        .setAudioProcessors(arrayOf(processor))
        .build()
    }
  }

  /**
   * Why a ForwardingPlayer: the notification and lock screen get their buttons from the session player's
   * available commands. A one-item ExoPlayer has no "next", so we advertise SEEK_TO_NEXT/PREVIOUS ourselves,
   * and when they are pressed we DO NOT skip in ExoPlayer: we forward the request to JS (onRemoteNext /
   * onRemotePrevious), because the track queue lives in JS. Same as MPRemoteCommandCenter on iOS.
   */
  private class RemoteButtonsPlayer(player: Player) : ForwardingPlayer(player) {
    override fun getAvailableCommands(): Player.Commands {
      return super.getAvailableCommands().buildUpon()
        .addAll(
          Player.COMMAND_SEEK_TO_NEXT,
          Player.COMMAND_SEEK_TO_PREVIOUS,
          Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
          Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM
        )
        .build()
    }

    override fun isCommandAvailable(command: Int): Boolean {
      return getAvailableCommands().contains(command)
    }

    override fun seekToNext() {
      onRemoteNext?.invoke()
    }

    override fun seekToPrevious() {
      onRemotePrevious?.invoke()
    }

    override fun seekToNextMediaItem() {
      onRemoteNext?.invoke()
    }

    override fun seekToPreviousMediaItem() {
      onRemotePrevious?.invoke()
    }
  }
}
