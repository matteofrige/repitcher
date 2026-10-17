@file:OptIn(UnstableApi::class)

package expo.modules.repitchaudio

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * Foreground service (type mediaPlayback) that keeps the music going in background and publishes the media
 * notification + lock-screen controls. It owns only the MediaSession; the ExoPlayer itself is the shared
 * singleton in [PlayerHolder], so the JS-driven module and the system UI always act on the same player.
 *
 * The service is created when the module binds a MediaController to its SessionToken
 * (see PlayerEngine.ensureSessionService); from then on Media3 starts/stops the foreground state by itself.
 */
class PlaybackService : MediaSessionService() {
  private var session: MediaSession? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    val builder = MediaSession.Builder(this, PlayerHolder.sessionPlayer(this))
    // Tapping the notification reopens the app.
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      builder.setSessionActivity(
        PendingIntent.getActivity(
          this,
          0,
          launch,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
      )
    }
    session = builder.build()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

  // App swiped away from recents: stop playing and shut the service down.
  override fun onTaskRemoved(rootIntent: Intent?) {
    pauseAllPlayersAndStopSelf()
  }

  /** Releases the session only (never the shared player). Safe to call more than once. */
  fun releaseSession() {
    session?.release()
    session = null
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    releaseSession()
    super.onDestroy()
  }

  companion object {
    @Volatile
    var instance: PlaybackService? = null
  }
}
