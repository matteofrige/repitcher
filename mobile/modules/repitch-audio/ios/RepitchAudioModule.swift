import AVFoundation
import ExpoModulesCore

public class RepitchAudioModule: Module {
  private let player = PlayerEngine()
  private lazy var metronome = MetronomeEngine(player: player)
  private let tuner = TunerEngine()
  private let tone = ToneEngine()

  public func definition() -> ModuleDefinition {
    Name("RepitchAudio")

    Events("onProgress", "onTrackEnd", "onPlayedSeconds", "onPlayingChange", "onRemoteNext", "onRemotePrevious",
           "onMetronomeBeat", "onTunerReading")

    OnCreate {
      player.onProgress = { [weak self] position, duration in
        self?.sendEvent("onProgress", ["position": position, "duration": duration])
      }
      player.onTrackEnd = { [weak self] in
        self?.sendEvent("onTrackEnd", [:])
      }
      player.onPlayedSeconds = { [weak self] seconds in
        self?.sendEvent("onPlayedSeconds", ["seconds": seconds])
      }
      player.onPlayingChange = { [weak self] isPlaying in
        self?.sendEvent("onPlayingChange", ["isPlaying": isPlaying])
      }
      player.onRemoteNext = { [weak self] in
        self?.sendEvent("onRemoteNext", [:])
      }
      player.onRemotePrevious = { [weak self] in
        self?.sendEvent("onRemotePrevious", [:])
      }
      metronome.onBeat = { [weak self] beat, accent in
        self?.sendEvent("onMetronomeBeat", ["beat": beat, "accent": accent])
      }
      tuner.onReading = { [weak self] reading in
        self?.sendEvent("onTunerReading", reading)
      }
    }

    AsyncFunction("load") { (uri: String, title: String?, promise: Promise) in
      self.player.load(uri: uri, title: title) { result in
        switch result {
        case .success(let duration):
          promise.resolve(["duration": duration])
        case .failure(let error):
          promise.reject("E_LOAD", error.localizedDescription)
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("play") { (promise: Promise) in
      do {
        try self.player.play()
        promise.resolve()
      } catch {
        promise.reject("E_PLAY", error.localizedDescription)
      }
    }.runOnQueue(.main)

    AsyncFunction("pause") {
      self.player.pause()
    }.runOnQueue(.main)

    AsyncFunction("seek") { (seconds: Double) in
      self.player.seek(seconds: seconds)
    }.runOnQueue(.main)

    AsyncFunction("setPitch") { (semitones: Double) in
      self.player.setPitch(semitones)
    }.runOnQueue(.main)

    // Heavy: runs on a background queue (not .main), one file at a time from JS.
    AsyncFunction("detectTuning") { (uri: String, promise: Promise) in
      let url = URL(string: uri).flatMap { $0.scheme != nil ? $0 : nil } ?? URL(fileURLWithPath: uri)
      DispatchQueue.global(qos: .utility).async {
        // ObjC `...error:(NSError **)` imports as a throwing Swift method.
        do {
          let result: [String: Any] = try RPTuningDetector.detectInFile(at: url)
          promise.resolve(result)
        } catch {
          promise.reject("E_DETECT", error.localizedDescription)
        }
      }
    }

    // Import check: same decoder the player uses (AVAudioFile), off the main thread.
    AsyncFunction("probeAudio") { (uri: String, promise: Promise) in
      let url = URL(string: uri).flatMap { $0.scheme != nil ? $0 : nil } ?? URL(fileURLWithPath: uri)
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let file = try AVAudioFile(forReading: url)
          let rate = file.fileFormat.sampleRate
          guard file.length > 0, file.processingFormat.sampleRate > 0, rate > 0 else {
            promise.reject("E_UNSUPPORTED", "Empty or undecodable audio file")
            return
          }
          promise.resolve(["duration": Double(file.length) / rate])
        } catch {
          promise.reject("E_UNSUPPORTED", error.localizedDescription)
        }
      }
    }

    // MARK: Metronome (C++ core on the shared playback engine) and tuner (separate input engine)

    AsyncFunction("metronomeStart") { (promise: Promise) in
      do {
        try self.metronome.start()
        promise.resolve()
      } catch {
        promise.reject("E_METRONOME", error.localizedDescription)
      }
    }.runOnQueue(.main)

    AsyncFunction("metronomeStop") {
      self.metronome.stop()
    }.runOnQueue(.main)

    AsyncFunction("metronomeConfigure") { (bpm: Double, beatsPerBar: Int, volume: Double) in
      self.metronome.configure(bpm: bpm, beatsPerBar: beatsPerBar, volume: volume)
    }.runOnQueue(.main)

    AsyncFunction("tunerStart") { (promise: Promise) in
      self.tuner.start { result in
        switch result {
        case .success:
          promise.resolve()
        case .failure(let error):
          if case TunerError.micDenied = error {
            promise.reject("E_MIC_DENIED", error.localizedDescription)
          } else {
            promise.reject("E_TUNER", error.localizedDescription)
          }
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("tunerStop") {
      self.tuner.stop()
    }.runOnQueue(.main)

    // Reference tone (own engine, mixes with the rest).
    AsyncFunction("toneStart") { (frequency: Double, volume: Double, promise: Promise) in
      do {
        try self.tone.start(frequency: frequency, volume: volume)
        promise.resolve()
      } catch {
        promise.reject("E_TONE", error.localizedDescription)
      }
    }.runOnQueue(.main)

    AsyncFunction("toneStop") {
      self.tone.stop()
    }.runOnQueue(.main)

    AsyncFunction("getStatus") { () -> [String: Any] in
      return self.player.status()
    }.runOnQueue(.main)
  }
}
