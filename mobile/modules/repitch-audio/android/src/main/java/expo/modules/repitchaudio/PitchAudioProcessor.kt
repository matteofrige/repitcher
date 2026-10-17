@file:OptIn(UnstableApi::class)

package expo.modules.repitchaudio

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Real-time pitch shift (Signalsmith Stretch via JNI) as a Media3 AudioProcessor, sitting inside
 * DefaultAudioSink between the decoder and the AudioTrack.
 *
 * Why EQUAL frames in/out: this is a pure pitch shift at rate 1.0, so every input frame produces exactly one
 * output frame. Media3 derives the playback position and the end of stream from the number of frames that go
 * through the sink; a processor that changed the duration would need to report it through an
 * AudioProcessorChain. Same contract as RPPitchAudioUnit on iOS.
 *
 * Output is always 16-bit PCM: with float output disabled, DefaultAudioSink places 16-bit-only processors
 * (Sonic, for speed) after the custom ones, and a float output makes the sink refuse the configuration
 * ("Unhandled input format ... encoding=4", seen on the first emulator run). Accepts 16/24/32-bit integer
 * PCM and float PCM, up to 8 channels.
 *
 * Threading: all AudioProcessor callbacks run on ExoPlayer's playback thread, so the native handle is only
 * ever touched there. [semitones] is written from the main thread and picked up at the start of the next
 * buffer (volatile = the "atomic"). A flush (seek, track change) resets the stretcher lazily in the next
 * queueInput, again on the playback thread.
 */
class PitchAudioProcessor : BaseAudioProcessor() {
  @Volatile
  var semitones: Float = 0f

  private var cfgChannels = 0
  private var cfgSampleRate = 0
  private var cfgEncoding = C.ENCODING_INVALID

  private var handle = 0L
  private var builtChannels = 0
  private var builtSampleRate = 0
  private var appliedSemitones = Float.NaN  // NaN forces the first stretchSetPitch
  private var resetPending = false

  /**
   * File time (µs) of the buffer currently entering the sink, set by [PlayerHolder]'s sink wrapper just before the
   * sink pushes it through the processors. The first buffer after a flush anchors the beat-follow clicks.
   */
  @Volatile
  var lastPtsUs: Long = 0L

  /** Stretcher delay (input + output), seconds. The audio heard at sink position p is the file at p - latency. */
  @Volatile
  var latencySeconds: Double = 0.0
    private set

  /** Click mixer for beat follow (native). Lives as long as the process; null if the library is missing. */
  private val follow: Long = if (NativeBridge.available) NativeBridge.followCreate() else 0L
  private var latencyFrames = 0
  private var segmentPending = true

  /** Main thread. Beats = file seconds, ascending. */
  fun setFollowBeats(beats: DoubleArray) {
    if (follow != 0L) NativeBridge.followSetBeats(follow, beats)
  }

  /** Main thread. */
  fun configureFollow(on: Boolean, clickAudible: Boolean, beatsPerBar: Int, downbeatIndex: Int, volume: Double) {
    if (follow != 0L) NativeBridge.followConfigure(follow, on, clickAudible, beatsPerBar, downbeatIndex, volume)
  }

  private var inScratch = FloatArray(0)
  private var outScratch = FloatArray(0)

  override fun onConfigure(inputAudioFormat: AudioFormat): AudioFormat {
    if (!NativeBridge.available) return AudioFormat.NOT_SET  // library missing: processor inactive = passthrough
    val supported = when (inputAudioFormat.encoding) {
      C.ENCODING_PCM_16BIT, C.ENCODING_PCM_24BIT, C.ENCODING_PCM_32BIT, C.ENCODING_PCM_FLOAT -> true
      else -> false
    }
    if (!supported || inputAudioFormat.channelCount < 1 || inputAudioFormat.channelCount > MAX_CHANNELS) {
      throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
    }
    cfgChannels = inputAudioFormat.channelCount
    cfgSampleRate = inputAudioFormat.sampleRate
    cfgEncoding = inputAudioFormat.encoding
    return AudioFormat(inputAudioFormat.sampleRate, inputAudioFormat.channelCount, C.ENCODING_PCM_16BIT)
  }

  override fun onFlush() {
    // Seek / new stream: drop the stretcher's internal overlap state (applied in the next queueInput).
    resetPending = true
    segmentPending = true
  }

  override fun onReset() {
    destroyHandle()
    resetPending = false
  }

  override fun queueInput(inputBuffer: ByteBuffer) {
    inputBuffer.order(ByteOrder.nativeOrder())  // decoder PCM is native-endian; make it explicit
    val channels = cfgChannels
    val bytesPerSample = bytesPerSample(cfgEncoding)
    val frames = inputBuffer.remaining() / (bytesPerSample * channels)
    if (frames == 0) {
      // Partial frame (should not happen): consume it so the pipeline never stalls.
      inputBuffer.position(inputBuffer.limit())
      return
    }

    ensureHandle()
    if (resetPending) {
      NativeBridge.stretchReset(handle)
      resetPending = false
    }
    if (segmentPending) {
      // First buffer after a flush: its file time is the sink's presentation timestamp.
      if (follow != 0L) NativeBridge.followSegment(follow, lastPtsUs / 1e6, latencyFrames)
      segmentPending = false
    }
    val semis = semitones
    if (semis != appliedSemitones) {
      NativeBridge.stretchSetPitch(handle, semis)
      appliedSemitones = semis
    }

    val out = replaceOutputBuffer(frames * channels * 2)
    val chunkFrames = CHUNK_FRAMES
    if (inScratch.size < chunkFrames * channels) {
      inScratch = FloatArray(chunkFrames * channels)
      outScratch = FloatArray(chunkFrames * channels)
    }

    var done = 0
    while (done < frames) {
      val n = minOf(chunkFrames, frames - done)
      val samples = n * channels
      readSamples(inputBuffer, cfgEncoding, inScratch, samples)
      NativeBridge.stretchProcess(handle, inScratch, outScratch, n)  // n frames in, n frames out
      // Beat-follow clicks go in AFTER the pitch shift (not shifted), at output frame = beat + stretcher latency.
      if (follow != 0L) NativeBridge.followMix(follow, outScratch, n, channels)
      for (i in 0 until samples) {
        val v = (outScratch[i] * 32767f).coerceIn(-32768f, 32767f)
        out.putShort(v.toInt().toShort())
      }
      done += n
    }
    // Trailing bytes shorter than a frame (should not happen) must not stay in the input buffer: the sink
    // keeps calling queueInput while the buffer has remaining bytes.
    if (inputBuffer.hasRemaining()) inputBuffer.position(inputBuffer.limit())
    out.flip()
  }

  private fun ensureHandle() {
    if (handle != 0L && builtChannels == cfgChannels && builtSampleRate == cfgSampleRate) return
    destroyHandle()
    handle = NativeBridge.stretchCreate(cfgChannels, cfgSampleRate)
    builtChannels = cfgChannels
    builtSampleRate = cfgSampleRate
    appliedSemitones = Float.NaN
    resetPending = false
    latencyFrames = if (handle != 0L) NativeBridge.stretchLatency(handle) else 0
    latencySeconds = if (cfgSampleRate > 0) latencyFrames.toDouble() / cfgSampleRate else 0.0
    if (follow != 0L) NativeBridge.followPrepare(follow, cfgSampleRate.toDouble())
    segmentPending = true
  }

  private fun destroyHandle() {
    if (handle != 0L) {
      NativeBridge.stretchDestroy(handle)
      handle = 0L
    }
  }

  private fun bytesPerSample(encoding: Int): Int = when (encoding) {
    C.ENCODING_PCM_16BIT -> 2
    C.ENCODING_PCM_24BIT -> 3
    else -> 4  // 32-bit int, float
  }

  /** Reads [count] samples from [buf] (advancing its position) into [dst] as floats in -1..1. */
  private fun readSamples(buf: ByteBuffer, encoding: Int, dst: FloatArray, count: Int) {
    when (encoding) {
      C.ENCODING_PCM_16BIT -> for (i in 0 until count) dst[i] = buf.short / 32768f
      C.ENCODING_PCM_24BIT -> for (i in 0 until count) {
        // Little-endian 3 bytes -> sign-extended int.
        val b0 = buf.get().toInt() and 0xFF
        val b1 = buf.get().toInt() and 0xFF
        val b2 = buf.get().toInt()  // signed: carries the sign
        dst[i] = ((b2 shl 16) or (b1 shl 8) or b0) / 8388608f
      }
      C.ENCODING_PCM_32BIT -> for (i in 0 until count) dst[i] = buf.int / 2147483648f
      else -> for (i in 0 until count) dst[i] = buf.float
    }
  }

  private companion object {
    const val MAX_CHANNELS = 8
    const val CHUNK_FRAMES = 4096
  }
}
