package expo.modules.repitchaudio

import android.content.Context
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri

/** Import-time check: can the platform decode this file? */
object AudioProbe {
  /** Returns the duration in seconds (0 if unknown); throws if there is no decodable audio track. */
  fun probe(ctx: Context, uriString: String): Double {
    val extractor = MediaExtractor()
    try {
      val uri = Uri.parse(uriString)
      when (uri.scheme) {
        null, "" -> extractor.setDataSource(uriString)
        "file" -> extractor.setDataSource(uri.path ?: throw IllegalArgumentException("Invalid URI: $uriString"))
        else -> extractor.setDataSource(ctx, uri, null)
      }
      for (i in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(i)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
        if (!mime.startsWith("audio/")) continue
        if (MediaCodecList(MediaCodecList.REGULAR_CODECS).findDecoderForFormat(format) == null) {
          throw IllegalStateException("No decoder for $mime")
        }
        return if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) / 1_000_000.0 else 0.0
      }
      throw IllegalStateException("No audio track")
    } finally {
      extractor.release()
    }
  }
}
