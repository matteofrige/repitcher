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
  private var follow: BeatFollowEngine? = null
  private var tuner: TunerEngine? = null
  private var tone: ToneEngine? = null
  private var detectExecutor: ExecutorService? = null
  private var probeExecutor: ExecutorService? = null
  private var beatExecutor: ExecutorService? = null

  private val appCtx: Context
    get() = appContext.reactContext?.applicationContext
      ?: throw IllegalStateException("React context is not available")

  /** Main thread only (creates the ExoPlayer). */
  private fun player(): PlayerEngine =
    player ?: PlayerEngine(appCtx) { name, body -> sendEvent(name, body) }.also { player = it }

  private fun metronome(): MetronomeEngine =
    metronome ?: MetronomeEngine { beat, accent, atMs ->
      sendEvent("onMetronomeBeat", mapOf("beat" to beat, "accent" to accent, "atMs" to atMs, "follow" to false))
    }.also { metronome = it }

  /** Main thread (needs the player). */
  private fun follow(): BeatFollowEngine =
    follow ?: BeatFollowEngine(player()) { beat, accent, atMs ->
      sendEvent("onMetronomeBeat", mapOf("beat" to beat, "accent" to accent, "atMs" to atMs, "follow" to true))
    }.also { follow = it }

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

    // Beat positions of the whole file (decode + Beat This! via ONNX Runtime, spectral fallback), background thread.
    AsyncFunction("detectBeats") { uri: String, anchors: List<Double>, beatsPerBar: Int, promise: Promise ->
      val ctx = try {
        appCtx
      } catch (e: Throwable) {
        promise.reject("E_DETECT", e.message, e)
        return@AsyncFunction
      }
      beatExecutor().execute {
        try {
          promise.resolve(BeatDetector.detect(ctx, uri, anchors.toDoubleArray(), beatsPerBar))
        } catch (e: Throwable) {
          promise.reject("E_DETECT", e.message ?: "Unable to analyse the file", e)
        }
      }
    }

    // Downbeat phase from the cached activation (no network run). Null when the file has no cache.
    AsyncFunction("beatDownbeatPhase") { uri: String, beats: List<Double>, beatsPerBar: Int, promise: Promise ->
      val ctx = try {
        appCtx
      } catch (e: Throwable) {
        promise.resolve(null)
        return@AsyncFunction
      }
      beatExecutor().execute {
        try {
          promise.resolve(BeatDetector.downbeatPhase(ctx, uri, beats.toDoubleArray(), beatsPerBar))
        } catch (e: Throwable) {
          promise.resolve(null)
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
        follow?.stop()  // mutually exclusive with beat follow
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

    // --- Beat follow: clicks (mixed in the player's pipeline) and flashes on the beats of the loaded track ---

    AsyncFunction("beatFollowStart") { beats: List<Double>, beatsPerBar: Int, downbeatIndex: Int, clickAudible: Boolean,
                                       volume: Double, promise: Promise ->
      try {
        check(NativeBridge.available) { "Native library not loaded" }
        metronome?.stop()  // mutually exclusive with the fixed-tempo metronome
        follow().start(beats.toDoubleArray(), beatsPerBar, downbeatIndex, clickAudible, volume)
        promise.resolve()
      } catch (e: Throwable) {
        promise.reject("E_BEAT_FOLLOW", e.message ?: "Unable to start the beat follow", e)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("beatFollowStop") { promise: Promise ->
      follow?.stop()
      promise.resolve()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("beatFollowConfigure") { clickAudible: Boolean, beatsPerBar: Int, downbeatIndex: Int, volume: Double,
                                           promise: Promise ->
      follow?.updateOptions(clickAudible, beatsPerBar, downbeatIndex, volume)
      promise.resolve()
    }.runOnQueue(Queues.MAIN)

    // File position (s) audible at a touch. RN 0.86 `nativeEvent.timestamp` is MotionEvent.getEventTime()
    // (TouchesHelper.kt / JSTouchDispatcher.kt), i.e. SystemClock.uptimeMillis(). If the value is missing or not
    // plausible (not within the last 1.5 s), "now minus 15 ms" like iOS. Null when the track isn't playing.
    AsyncFunction("beatTapPosition") { uptimeMs: Double, promise: Promise ->
      try {
        val audible = player().audibleSeconds()
        if (audible == null) {
          promise.resolve(null)
        } else {
          val now = android.os.SystemClock.uptimeMillis().toDouble()
          var t = uptimeMs
          if (!t.isFinite() || t > now + 50 || now - t > 1500) t = now - 15
          promise.resolve(audible - (now - t) / 1000.0)
        }
      } catch (e: Throwable) {
        promise.resolve(null)
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
      follow?.stop()
      follow = null
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
        beatExecutor?.shutdownNow()
        beatExecutor = null
      }
      val p = player
      player = null
      if (p != null) {
        // ExoPlayer must be released on its application looper (main).
        android.os.Handler(android.os.Looper.getMainLooper()).post { p.release() }
      }
    }
  }

  private fun beatExecutor(): ExecutorService = synchronized(this) {
    beatExecutor ?: Executors.newSingleThreadExecutor().also { beatExecutor = it }
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
