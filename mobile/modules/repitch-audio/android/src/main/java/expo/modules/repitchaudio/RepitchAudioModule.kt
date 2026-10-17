package expo.modules.repitchaudio

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Android implementation of the "RepitchAudio" module, feature-for-feature with ios/RepitchAudioModule.swift:
 * same function names / arguments / return shapes, same events and payloads, same error codes
 * (E_LOAD, E_PLAY, E_DETECT, E_METRONOME, E_MIC_DENIED, E_TUNER, E_TONE).
 *
 *  - player functions run on the main queue (ExoPlayer lives on the main looper);
 *  - detectTuning runs on its own single background thread (one file at a time);
 *  - metronome / tuner calls are cheap and also go through the main queue; their audio threads are their own.
 */
class RepitchAudioModule : Module() {
  private var player: PlayerEngine? = null
  private var metronome: MetronomeEngine? = null
  private var tuner: TunerEngine? = null
  private var tone: ToneEngine? = null
  private var detectExecutor: ExecutorService? = null
  private var probeExecutor: ExecutorService? = null

  private val appCtx: Context
    get() = appContext.reactContext?.applicationContext
      ?: throw IllegalStateException("React context is not available")

  /** Main thread only (creates the ExoPlayer). */
  private fun player(): PlayerEngine =
    player ?: PlayerEngine(appCtx) { name, body -> sendEvent(name, body) }.also { player = it }

  private fun metronome(): MetronomeEngine =
    metronome ?: MetronomeEngine { beat, accent, atMs ->
      sendEvent("onMetronomeBeat", mapOf("beat" to beat, "accent" to accent, "atMs" to atMs))
    }.also { metronome = it }

  private fun tuner(): TunerEngine =
    tuner ?: TunerEngine { reading -> sendEvent("onTunerReading", reading) }.also { tuner = it }

  private fun tone(): ToneEngine = tone ?: ToneEngine().also { tone = it }

  override fun definition() = ModuleDefinition {
    Name("RepitchAudio")

    Events(
      "onProgress", "onTrackEnd", "onPlayedSeconds", "onPlayingChange", "onRemoteNext", "onRemotePrevious",
      "onMetronomeBeat", "onTunerReading"
    )

    // --- Player ---

    AsyncFunction("load") { uri: String, title: String?, promise: Promise ->
      try {
        player().load(uri, title) { result ->
          result.fold(
            onSuccess = { duration -> promise.resolve(mapOf("duration" to duration)) },
            onFailure = { e -> promise.reject("E_LOAD", e.message ?: "Unable to load the track", e) }
          )
        }
      } catch (e: Throwable) {
        promise.reject("E_LOAD", e.message ?: "Unable to load the track", e)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("play") { promise: Promise ->
      try {
        player().play()
        promise.resolve()
      } catch (e: Throwable) {
        promise.reject("E_PLAY", e.message ?: "Unable to play", e)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("pause") { promise: Promise ->
      try {
        player().pause()
        promise.resolve()
      } catch (e: Throwable) {
        promise.reject("E_PLAY", e.message ?: "Unable to pause", e)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("seek") { seconds: Double, promise: Promise ->
      try {
        player().seek(seconds)
        promise.resolve()
      } catch (e: Throwable) {
        promise.reject("E_PLAY", e.message ?: "Unable to seek", e)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setPitch") { semitones: Double, promise: Promise ->
      try {
        player().setPitch(semitones)
        promise.resolve()
      } catch (e: Throwable) {
        promise.reject("E_PLAY", e.message ?: "Unable to set the pitch", e)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getStatus") { promise: Promise ->
      try {
        promise.resolve(player().status())
      } catch (e: Throwable) {
        promise.reject("E_PLAY", e.message ?: "Unable to read the status", e)
      }
    }.runOnQueue(Queues.MAIN)

    // --- Tuning detection: heavy, background thread, one file at a time ---

    AsyncFunction("detectTuning") { uri: String, promise: Promise ->
      val ctx = try {
        appCtx
      } catch (e: Throwable) {
        promise.reject("E_DETECT", e.message, e)
        return@AsyncFunction
      }
      val executor = synchronized(this@RepitchAudioModule) {
        detectExecutor ?: Executors.newSingleThreadExecutor().also { detectExecutor = it }
      }
      executor.execute {
        try {
          promise.resolve(TuningDetector.detect(ctx, uri))
        } catch (e: Throwable) {
          promise.reject("E_DETECT", e.message ?: "Unable to analyse the file", e)
        }
      }
    }

    // Import check: opens the file with the platform decoder, off the main thread.
    AsyncFunction("probeAudio") { uri: String, promise: Promise ->
      val ctx = try {
        appCtx
      } catch (e: Throwable) {
        promise.reject("E_UNSUPPORTED", e.message, e)
        return@AsyncFunction
      }
      val executor = synchronized(this@RepitchAudioModule) {
        probeExecutor ?: Executors.newSingleThreadExecutor().also { probeExecutor = it }
      }
      executor.execute {
        try {
          promise.resolve(mapOf("duration" to AudioProbe.probe(ctx, uri)))
        } catch (e: Throwable) {
          promise.reject("E_UNSUPPORTED", e.message ?: "Unsupported audio file", e)
        }
      }
    }

    // --- Metronome (own AudioTrack, mixes with the player's) ---

    AsyncFunction("metronomeStart") { promise: Promise ->
      try {
        metronome().start()
        promise.resolve()
      } catch (e: Throwable) {
        promise.reject("E_METRONOME", e.message ?: "Unable to start the metronome", e)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("metronomeStop") { promise: Promise ->
      try {
        metronome().stop()
        promise.resolve()
      } catch (e: Throwable) {
        promise.reject("E_METRONOME", e.message ?: "Unable to stop the metronome", e)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("metronomeConfigure") { bpm: Double, beatsPerBar: Int, volume: Double, promise: Promise ->
      try {
        metronome().configure(bpm, beatsPerBar, volume)
        promise.resolve()
      } catch (e: Throwable) {
        promise.reject("E_METRONOME", e.message ?: "Unable to configure the metronome", e)
      }
    }.runOnQueue(Queues.MAIN)

    // --- Tuner (microphone) ---

    AsyncFunction("tunerStart") { promise: Promise ->
      try {
        if (tuner().isRunning) {
          promise.resolve()
          return@AsyncFunction
        }
        val ctx = appCtx
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) ==
          PackageManager.PERMISSION_GRANTED
        ) {
          startTuner(ctx, promise)
        } else {
          val permissions = appContext.permissions
          if (permissions == null) {
            promise.reject("E_TUNER", "Permissions module is not available", null)
          } else {
            // Runtime permission dialog (Expo's permission manager, like expo-audio / expo-camera).
            permissions.askForPermissions(
              PermissionsResponseListener { result ->
                val granted = result[Manifest.permission.RECORD_AUDIO]?.status == PermissionsStatus.GRANTED
                if (granted) {
                  startTuner(ctx, promise)
                } else {
                  promise.reject("E_MIC_DENIED", "Microphone permission denied", null)
                }
              },
              Manifest.permission.RECORD_AUDIO
            )
          }
        }
      } catch (e: Throwable) {
        promise.reject("E_TUNER", e.message ?: "Unable to start the tuner", e)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("tunerStop") { promise: Promise ->
      try {
        tuner().stop()
        promise.resolve()
      } catch (e: Throwable) {
        promise.reject("E_TUNER", e.message ?: "Unable to stop the tuner", e)
      }
    }.runOnQueue(Queues.MAIN)

    // --- Reference tone (own AudioTrack) ---

    AsyncFunction("toneStart") { frequency: Double, volume: Double, promise: Promise ->
      try {
        tone().start(frequency, volume)
        promise.resolve()
      } catch (e: Throwable) {
        promise.reject("E_TONE", e.message ?: "Unable to start the tone", e)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("toneStop") { promise: Promise ->
      try {
        tone().stop()
        promise.resolve()
      } catch (e: Throwable) {
        promise.reject("E_TONE", e.message ?: "Unable to stop the tone", e)
      }
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      tone?.release()
      tone = null
      // Mic and click thread first (they are independent of the player), then the player + session service.
      tuner?.stop()
      tuner = null
      metronome?.release()
      metronome = null
      synchronized(this@RepitchAudioModule) {
        detectExecutor?.shutdownNow()
        detectExecutor = null
        probeExecutor?.shutdownNow()
        probeExecutor = null
      }
      val p = player
      player = null
      if (p != null) {
        // ExoPlayer must be released on its application looper (main).
        android.os.Handler(android.os.Looper.getMainLooper()).post { p.release() }
      }
    }
  }

  private fun startTuner(ctx: Context, promise: Promise) {
    try {
      tuner().start(ctx)
      promise.resolve()
    } catch (e: SecurityException) {
      promise.reject("E_MIC_DENIED", "Microphone permission denied", e)
    } catch (e: Throwable) {
      promise.reject("E_TUNER", e.message ?: "Unable to start the tuner", e)
    }
  }
}
