package expo.modules.repitchaudio

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.nio.ByteOrder

/**
 * Estimates the tuning (reference A) of a file: Android counterpart of ios/RPTuningDetector.mm.
 * Same analysis: three windows of up to 25 s centred at 25 % / 50 % / 75 % of the file (or the whole file
 * when it is <= 75 s), mixed down to mono at the file's native rate (no resampling), concatenated and fed to
 * TuningEstimator. Result keys: valid, refHz, cents, confidence.
 *
 * Decoding is MediaExtractor + MediaCodec (synchronous mode). Windows are defined in seconds (from the
 * container duration) and sample-trimmed using the decoder's presentation timestamps.
 *
 * Blocking and heavy: call from a background thread.
 */
object TuningDetector {
  private const val WINDOW_SECONDS = 25.0
  private val CENTERS = doubleArrayOf(0.25, 0.50, 0.75)
  private const val TIMEOUT_US = 10_000L
  private const val MAX_IDLE_ROUNDS = 1_000  // ~10 s of silence from the decoder

  private class FloatBuf {
    var data = FloatArray(1 shl 16)
    var size = 0
    fun add(v: Float) {
      if (size == data.size) data = data.copyOf(data.size * 2)
      data[size++] = v
    }
  }

  private val empty: Map<String, Any> = mapOf("valid" to false, "refHz" to 0.0, "cents" to 0.0, "confidence" to 0.0)

  fun detect(context: Context, uriString: String): Map<String, Any> {
    check(NativeBridge.available) { "Native library not loaded" }
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      setSource(extractor, context, uriString)
      var trackIndex = -1
      var format: MediaFormat? = null
      for (i in 0 until extractor.trackCount) {
        val f = extractor.getTrackFormat(i)
        if (f.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) {
          trackIndex = i
          format = f
          break
        }
      }
      if (trackIndex < 0 || format == null) throw IllegalStateException("No audio track")
      extractor.selectTrack(trackIndex)

      val mime = format.getString(MediaFormat.KEY_MIME)!!
      val durationSec =
        if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) / 1e6 else 0.0

      // (startSeconds, lengthSeconds). length < 0 = until the end of the stream.
      val ranges = ArrayList<Pair<Double, Double>>()
      if (durationSec <= 0.0) {
        ranges.add(0.0 to 3 * WINDOW_SECONDS)  // unknown duration: first 75 s
      } else if (durationSec <= 3 * WINDOW_SECONDS) {
        ranges.add(0.0 to -1.0)
      } else {
        for (c in CENTERS) {
          val start = (c * durationSec - WINDOW_SECONDS / 2).coerceIn(0.0, durationSec - WINDOW_SECONDS)
          ranges.add(start to WINDOW_SECONDS)
        }
      }

      val dec = MediaCodec.createDecoderByType(mime)
      codec = dec
      dec.configure(format, null, null, 0)
      dec.start()

      val mono = FloatBuf()
      val state = DecodeState(
        sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE),
        channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      )
      for ((startSec, lengthSec) in ranges) {
        decodeWindow(extractor, dec, state, mono, startSec, lengthSec)
      }

      if (mono.size == 0 || state.sampleRate <= 0) return empty
      val r = NativeBridge.tuningEstimate(mono.data, mono.size, state.sampleRate.toFloat())
      return mapOf(
        "valid" to (r[0] != 0.0),
        "refHz" to r[1],
        "cents" to r[2],
        "confidence" to r[3]
      )
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

  internal fun setSource(extractor: MediaExtractor, context: Context, uriString: String) {
    val uri = Uri.parse(uriString)
    when (uri.scheme) {
      null, "" -> extractor.setDataSource(uriString)
      "file" -> extractor.setDataSource(uri.path ?: throw IllegalArgumentException("Invalid URI: $uriString"))
      else -> extractor.setDataSource(context, uri, null)
    }
  }

  /** Output format as reported by the decoder (it can differ from the container's, e.g. HE-AAC). */
  private class DecodeState(var sampleRate: Int, var channels: Int) {
    var floatPcm = false
  }

  private fun decodeWindow(
    extractor: MediaExtractor,
    codec: MediaCodec,
    state: DecodeState,
    out: FloatBuf,
    startSec: Double,
    lengthSec: Double
  ) {
    val startUs = (startSec * 1e6).toLong()
    extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
    codec.flush()

    val info = MediaCodec.BufferInfo()
    var inputDone = false
    var outputDone = false
    var firstBuffer = true
    var toSkip = 0L  // frames before the window start (the seek lands on a sync sample before it)
    var collected = 0L
    var maxFrames = Long.MAX_VALUE  // fixed once the output sample rate is known
    var lengthKnown = false
    // Guard against a decoder that never delivers EOS (or any output): bounded number of idle rounds.
    var idleRounds = 0

    while (!outputDone) {
      if (!inputDone) {
        val inIdx = codec.dequeueInputBuffer(TIMEOUT_US)
        if (inIdx >= 0) {
          val buf = codec.getInputBuffer(inIdx)!!
          val n = extractor.readSampleData(buf, 0)
          if (n < 0) {
            codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            inputDone = true
          } else {
            codec.queueInputBuffer(inIdx, 0, n, extractor.sampleTime, 0)
            extractor.advance()
          }
        }
      }

      val outIdx = codec.dequeueOutputBuffer(info, TIMEOUT_US)
      if (outIdx < 0) {
        // ~MAX_IDLE_ROUNDS x TIMEOUT_US with nothing coming out: give up on this window with what we have.
        if (++idleRounds > MAX_IDLE_ROUNDS) break
      } else {
        idleRounds = 0
      }
      when {
        outIdx >= 0 -> {
          if (info.size > 0) {
            val fmt = codec.outputFormat
            state.sampleRate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            state.channels = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            state.floatPcm = android.os.Build.VERSION.SDK_INT >= 24 &&
              fmt.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
              fmt.getInteger(MediaFormat.KEY_PCM_ENCODING) == android.media.AudioFormat.ENCODING_PCM_FLOAT
            if (!lengthKnown) {
              maxFrames = if (lengthSec < 0) Long.MAX_VALUE else (lengthSec * state.sampleRate).toLong()
              lengthKnown = true
            }
            if (firstBuffer) {
              firstBuffer = false
              toSkip = (((startUs - info.presentationTimeUs).coerceAtLeast(0L)) * state.sampleRate / 1_000_000L)
            }
            val bb = codec.getOutputBuffer(outIdx)!!
            bb.position(info.offset)
            bb.limit(info.offset + info.size)
            bb.order(ByteOrder.nativeOrder())
            val ch = state.channels.coerceAtLeast(1)
            val bytesPerSample = if (state.floatPcm) 4 else 2
            val frames = info.size / (bytesPerSample * ch)
            for (f in 0 until frames) {
              var sum = 0f
              for (c in 0 until ch) sum += if (state.floatPcm) bb.float else bb.short / 32768f
              if (toSkip > 0) {
                toSkip--
              } else if (collected < maxFrames) {
                out.add(sum / ch)
                collected++
              }
            }
          }
          codec.releaseOutputBuffer(outIdx, false)
          if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true
          if (collected >= maxFrames) outputDone = true
        }
        // INFO_OUTPUT_FORMAT_CHANGED: the format is re-read with every buffer above.
        // INFO_TRY_AGAIN_LATER: just loop (input keeps being fed).
      }
    }
  }
}
