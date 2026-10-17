package expo.modules.repitchaudio

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.util.Log
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.Locale
import kotlin.math.max
import kotlin.math.round

/**
 * Beat positions of a whole file: Android counterpart of ios/RPBeatDetector.mm, same decision order and result keys.
 *
 *  1. activation cache hit (cacheDir/RePitchBeats, same key + format as iOS) -> straight to the HMM;
 *  2. else decode -> BeatThisFrontend spectrogram -> Beat This! network (ONNX Runtime, 1500-frame chunks) -> cache;
 *  3. BeatTracker.analyzeActivation with the user's anchors + downbeat phase ("neural");
 *  4. if the model can't run (missing / failing, remembered for the process like gModelBroken) -> spectral-flux
 *     tracker over a fresh decode ("spectral").
 *
 * Heavy and blocking: call from a background thread. One file at a time (the module uses a single executor).
 */
object BeatDetector {
  private const val TAG = "RePitchBeats"
  private const val MODEL_ASSET = "BeatThis.onnx"
  private const val CHUNK = 1500
  private const val MELS = 128

  // ---- Public API --------------------------------------------------------------------------------------------

  fun detect(context: Context, uriString: String, anchors: DoubleArray, beatsPerBar: Int): Map<String, Any> {
    check(NativeBridge.available) { "Native library not loaded" }
    val clean = anchors.filter { it.isFinite() && it >= 0 }.toDoubleArray()
    try {
      detectNeural(context, uriString, clean, beatsPerBar)?.let { return it }
    } catch (e: HardError) {
      throw e.cause ?: e
    } catch (e: Throwable) {
      Log.w(TAG, "neural path failed", e)
    }
    Log.i(TAG, "falling back to the spectral tracker")
    return detectSpectral(context, uriString, clean)
  }

  /** {downbeatIndex, margin} from the cached activation, or null when there is none. */
  fun downbeatPhase(context: Context, uriString: String, beats: DoubleArray, beatsPerBar: Int): Map<String, Any>? {
    if (!NativeBridge.available) return null
    val cached = loadCache(context, uriString) ?: return null
    val act = NativeBridge.beatActCreate(cached.data, cached.frames, cached.fps)
    if (act == 0L) return null
    try {
      val r = NativeBridge.beatActDownbeatPhase(act, beats, max(beatsPerBar, 2)) ?: return null
      return mapOf("downbeatIndex" to r[0].toInt(), "margin" to r[1])
    } finally {
      NativeBridge.beatActDestroy(act)
    }
  }

  // ---- Neural path --------------------------------------------------------------------------------------------

  /** A decode/read error on the file itself: surfaced to JS instead of falling back (iOS `hardError`). */
  private class HardError(cause: Throwable) : RuntimeException(cause)

  private fun detectNeural(context: Context, uri: String, anchors: DoubleArray, beatsPerBar: Int): Map<String, Any>? {
    var act = 0L
    try {
      val cached = loadCache(context, uri)
      if (cached != null) act = NativeBridge.beatActCreate(cached.data, cached.frames, cached.fps)
      if (act == 0L) {
        if (BeatModel.broken) return null
        act = computeActivation(context, uri) ?: return null
        saveCache(context, uri, act)
      }
      val r = NativeBridge.beatActAnalyze(act, anchors, max(beatsPerBar, 2)) ?: return null
      return unpack(r, "neural")
    } finally {
      if (act != 0L) NativeBridge.beatActDestroy(act)
    }
  }

  /** Decode + spectrogram + network. Returns an Act handle (caller destroys) or null if the net can't run. */
  private fun computeActivation(context: Context, uri: String): Long? {
    val fe = NativeBridge.beatFrontendCreate()
    var net = 0L
    try {
      var started = false
      val decoded = try {
        BeatDecoder.decodeMono(context, uri, object : BeatDecoder.Sink {
          override fun start(sampleRate: Int) {
            started = NativeBridge.beatFrontendBegin(fe, sampleRate.toDouble())
          }

          override fun push(samples: FloatArray, count: Int) {
            if (started) NativeBridge.beatFrontendPush(fe, samples, count)
          }
        })
      } catch (e: Throwable) {
        throw HardError(e)
      }
      if (!decoded || !started) return null
      net = NativeBridge.beatFrontendFinish(fe)
      if (net == 0L) return null
      if (!BeatModel.run(context, net)) return null
      val act = NativeBridge.beatNetStitch(net)
      return if (act == 0L) null else act
    } finally {
      if (net != 0L) NativeBridge.beatNetDestroy(net)
      NativeBridge.beatFrontendDestroy(fe)
    }
  }

  // ---- ONNX Runtime ---------------------------------------------------------------------------------------------

  private object BeatModel {
    @Volatile
    var broken = false
    private var env: OrtEnvironment? = null
    private var session: OrtSession? = null

    private val input: ByteBuffer by lazy { ByteBuffer.allocateDirect(CHUNK * MELS * 4).order(ByteOrder.nativeOrder()) }

    /**
     * Copies the asset to the cache dir once per app install/update (ORT maps a file; a 21 MB byte[] would sit on the
     * Java heap). Keyed on the package's lastUpdateTime: works whether or not the asset is stored compressed.
     */
    private fun modelFile(context: Context): File {
      val dir = File(context.cacheDir, "RePitchModels").apply { mkdirs() }
      val stamp = try {
        context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime
      } catch (t: Throwable) {
        0L
      }
      val f = File(dir, "BeatThis-$stamp.onnx")
      if (!f.isFile || f.length() == 0L) {
        val tmp = File(dir, "BeatThis-$stamp.tmp")
        context.assets.open(MODEL_ASSET).use { i -> tmp.outputStream().use { o -> i.copyTo(o, 1 shl 16) } }
        check(tmp.renameTo(f)) { "Unable to install the model" }
        dir.listFiles()?.forEach { if (it != f) it.delete() }
      }
      return f
    }

    @Synchronized
    private fun session(context: Context): OrtSession? {
      if (broken) return null
      session?.let { return it }
      return try {
        val e = OrtEnvironment.getEnvironment()
        val opts = OrtSession.SessionOptions().apply {
          setIntraOpNumThreads(Runtime.getRuntime().availableProcessors().coerceIn(2, 4))
          setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
          // Peak memory of the attention maps is the issue, not speed: give it back after every run.
          setCPUArenaAllocator(false)
          setMemoryPatternOptimization(false)
        }
        val s = e.createSession(modelFile(context).absolutePath, opts)
        env = e
        session = s
        s
      } catch (t: Throwable) {
        Log.w(TAG, "model load failed", t)
        broken = true
        null
      }
    }

    /** Runs every chunk of [net] and stores the outputs. False if the model can't run (then it stays broken). */
    fun run(context: Context, net: Long): Boolean {
      val s = session(context) ?: return false
      val e = env ?: return false
      try {
        val chunks = NativeBridge.beatNetChunkCount(net)
        val fb = input.asFloatBuffer()
        val beat = FloatArray(CHUNK)
        val down = FloatArray(CHUNK)
        for (q in 0 until chunks) {
          val len = NativeBridge.beatNetFill(net, q, input)
          if (len <= 0) return false
          fb.rewind()
          OnnxTensor.createTensor(e, fb, longArrayOf(1, CHUNK.toLong(), MELS.toLong())).use { t ->
            s.run(mapOf("spect" to t)).use { out ->
              val b = (out.get("beat").orElse(null) as? OnnxTensor)?.floatBuffer
              val d = (out.get("downbeat").orElse(null) as? OnnxTensor)?.floatBuffer
              if (b == null || d == null || b.remaining() < len || d.remaining() < len) error("unexpected model output")
              b.get(beat, 0, len)
              d.get(down, 0, len)
            }
          }
          if (!NativeBridge.beatNetSetOutput(net, q, beat, down)) return false
        }
        return true
      } catch (t: Throwable) {
        Log.w(TAG, "prediction failed", t)
        broken = true
        return false
      }
    }
  }

  // ---- Spectral fallback ----------------------------------------------------------------------------------------

  private fun detectSpectral(context: Context, uri: String, anchors: DoubleArray): Map<String, Any> {
    val h = NativeBridge.beatSpectralCreate(anchors)
    try {
      var started = false
      val decoded = BeatDecoder.decodeMono(context, uri, object : BeatDecoder.Sink {
        override fun start(sampleRate: Int) {
          NativeBridge.beatSpectralBegin(h, sampleRate.toDouble())
          started = true
        }

        override fun push(samples: FloatArray, count: Int) {
          if (started) NativeBridge.beatSpectralPush(h, samples, count)
        }
      })
      if (!decoded || !started) {
        return mapOf(
          "valid" to false, "uncertain" to false, "bpm" to 0.0, "confidence" to 0.0, "beats" to emptyList<Double>(),
          "method" to "spectral", "downbeatIndex" to 0, "downbeatMargin" to 0.0
        )
      }
      val r = NativeBridge.beatSpectralFinish(h) ?: error("Beat tracker failed")
      return unpack(r, "spectral")
    } finally {
      NativeBridge.beatSpectralDestroy(h)
    }
  }

  private fun unpack(r: DoubleArray, method: String): Map<String, Any> {
    val beats = ArrayList<Double>(max(0, r.size - 6))
    for (i in 6 until r.size) beats.add(round(r[i] * 10000.0) / 10000.0)
    return mapOf(
      "valid" to (r[0] != 0.0),
      "uncertain" to (r[1] != 0.0),
      "bpm" to r[2],
      "confidence" to r[3],
      "beats" to beats,
      "method" to method,
      "downbeatIndex" to r[4].toInt(),
      "downbeatMargin" to r[5]
    )
  }

  // ---- Activation cache (same key + format as iOS) -----------------------------------------------------------------
  // File: cacheDir/RePitchBeats/<sha1("path|size|mtimeSeconds(%.3f)")>.bin
  // Layout (little endian): u32 magic 'RPBA' (0x41425052), u32 version 1, u32 frames, f32 fps, f32 beat[frames], f32 down[frames].

  private const val MAGIC = 0x41425052
  private const val VERSION = 1

  private class Cached(val data: FloatArray, val frames: Int, val fps: Float)

  private fun cacheFile(context: Context, uriString: String): File? {
    val path = filePath(uriString) ?: return null
    val f = File(path)
    if (!f.isFile) return null
    val key = String.format(Locale.US, "%s|%d|%.3f", path, f.length(), f.lastModified() / 1000.0)
    val hex = MessageDigest.getInstance("SHA-1").digest(key.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it) }
    val dir = File(context.cacheDir, "RePitchBeats")
    if (!dir.isDirectory && !dir.mkdirs()) return null
    return File(dir, "$hex.bin")
  }

  private fun filePath(uriString: String): String? {
    val uri = Uri.parse(uriString)
    return when (uri.scheme) {
      null, "" -> uriString
      "file" -> uri.path
      else -> null  // content://...: no stable path/size/mtime => no cache
    }
  }

  private fun loadCache(context: Context, uriString: String): Cached? {
    return try {
      val f = cacheFile(context, uriString) ?: return null
      if (!f.isFile || f.length() < 16) return null
      val bytes = f.readBytes()
      val bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
      val magic = bb.int
      val version = bb.int
      val frames = bb.int
      val fps = bb.float
      if (magic != MAGIC || version != VERSION || frames <= 0 || !(fps >= 10f)) return null
      if (bytes.size.toLong() != 16L + 8L * frames) return null
      val data = FloatArray(2 * frames)
      bb.asFloatBuffer().get(data)
      Cached(data, frames, fps)
    } catch (t: Throwable) {
      null
    }
  }

  private fun saveCache(context: Context, uriString: String, act: Long) {
    try {
      val f = cacheFile(context, uriString) ?: return
      val data = NativeBridge.beatActData(act) ?: return
      val frames = NativeBridge.beatActFrames(act)
      val bb = ByteBuffer.allocate(16 + 8 * frames).order(ByteOrder.LITTLE_ENDIAN)
      bb.putInt(MAGIC).putInt(VERSION).putInt(frames).putFloat(NativeBridge.beatActFps(act))
      bb.asFloatBuffer().put(data, 0, 2 * frames)
      val tmp = File(f.parentFile, f.name + ".tmp")
      tmp.writeBytes(bb.array())
      if (!tmp.renameTo(f)) tmp.delete()
    } catch (t: Throwable) {
      Log.w(TAG, "cache write failed", t)
    }
  }
}

/** Streaming mono decode of a whole file with MediaExtractor + MediaCodec (same approach as [TuningDetector]). */
object BeatDecoder {
  interface Sink {
    /** Once, with the decoder's real output rate, before the first [push]. */
    fun start(sampleRate: Int)

    /** Mono samples (valid for the call only). */
    fun push(samples: FloatArray, count: Int)
  }

  private const val TIMEOUT_US = 10_000L
  private const val MAX_IDLE_ROUNDS = 1_000
  private const val BLOCK = 32768

  /** True if any audio was produced. Throws if the file can't be opened/decoded. */
  fun decodeMono(context: Context, uriString: String, sink: Sink): Boolean {
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      TuningDetector.setSource(extractor, context, uriString)
      var track = -1
      var format: MediaFormat? = null
      for (i in 0 until extractor.trackCount) {
        val f = extractor.getTrackFormat(i)
        if (f.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) {
          track = i
          format = f
          break
        }
      }
      if (track < 0 || format == null) throw IllegalStateException("No audio track")
      extractor.selectTrack(track)
      val dec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
      codec = dec
      dec.configure(format, null, null, 0)
      dec.start()

      val info = MediaCodec.BufferInfo()
      val mono = FloatArray(BLOCK)
      var fill = 0
      var started = false
      var any = false
      var inputDone = false
      var outputDone = false
      var idle = 0
      while (!outputDone) {
        if (!inputDone) {
          val inIdx = dec.dequeueInputBuffer(TIMEOUT_US)
          if (inIdx >= 0) {
            val buf = dec.getInputBuffer(inIdx)!!
            val n = extractor.readSampleData(buf, 0)
            if (n < 0) {
              dec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              dec.queueInputBuffer(inIdx, 0, n, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }
        val outIdx = dec.dequeueOutputBuffer(info, TIMEOUT_US)
        if (outIdx < 0) {
          if (++idle > MAX_IDLE_ROUNDS) break
          continue
        }
        idle = 0
        if (info.size > 0) {
          val fmt = dec.outputFormat
          val sr = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          val ch = max(1, fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT))
          val floatPcm = android.os.Build.VERSION.SDK_INT >= 24 && fmt.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
            fmt.getInteger(MediaFormat.KEY_PCM_ENCODING) == android.media.AudioFormat.ENCODING_PCM_FLOAT
          if (!started) {
            sink.start(sr)
            started = true
          }
          val bb = dec.getOutputBuffer(outIdx)!!
          bb.position(info.offset)
          bb.limit(info.offset + info.size)
          bb.order(ByteOrder.nativeOrder())
          val frames = info.size / ((if (floatPcm) 4 else 2) * ch)
          for (f in 0 until frames) {
            var sum = 0f
            for (c in 0 until ch) sum += if (floatPcm) bb.float else bb.short / 32768f
            mono[fill++] = sum / ch
            if (fill == BLOCK) {
              sink.push(mono, fill)
              any = true
              fill = 0
            }
          }
        }
        dec.releaseOutputBuffer(outIdx, false)
        if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true
      }
      if (fill > 0 && started) {
        sink.push(mono, fill)
        any = true
      }
      return any
    } finally {
      try {
        codec?.stop()
      } catch (e: Throwable) {
      }
      try {
        codec?.release()
      } catch (e: Throwable) {
      }
      extractor.release()
    }
  }
}
