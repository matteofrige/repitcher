import AVFoundation

enum TunerError: LocalizedError {
  case micDenied
  case noInput

  var errorDescription: String? {
    switch self {
    case .micDenied: return "Microphone permission denied"
    case .noInput: return "No audio input available"
    }
  }
}

/// Tuner input: a SEPARATE AVAudioEngine (input only), so the playback engine is never touched.
/// The tap feeds RPPitchDetectorBridge (C++ MPM); a 30 Hz main-queue timer reports the latest reading to JS.
///
/// Session order (see AudioSessionCoordinator): start = permission -> category .playAndRecord/.measurement
/// -> engine; stop = remove tap -> stop engine -> back to .playback/.default WITHOUT setActive(false), so a
/// track that is playing keeps playing.
/// Main thread only.
final class TunerEngine {
  var onReading: (([String: Any]) -> Void)?
  private(set) var isRunning = false

  private let bridge = RPPitchDetectorBridge()
  private var engine: AVAudioEngine?
  private var timer: DispatchSourceTimer?
  private var lastSeq = -1
  private var observers: [NSObjectProtocol] = []

  func start(completion: @escaping (Result<Void, Error>) -> Void) {
    if isRunning {
      completion(.success(()))
      return
    }
    requestPermission { [weak self] granted in
      DispatchQueue.main.async {
        guard let self else { return }
        guard granted else {
          completion(.failure(TunerError.micDenied))
          return
        }
        if self.isRunning {  // a second start() raced with this one
          completion(.success(()))
          return
        }
        do {
          try AudioSessionCoordinator.shared.enterRecording()
          try self.startEngine()
          self.isRunning = true
          self.lastSeq = -1
          self.startTimer()
          self.installObservers()
          completion(.success(()))
        } catch {
          self.stopEngine()
          AudioSessionCoordinator.shared.leaveRecording()
          completion(.failure(error))
        }
      }
    }
  }

  func stop() {
    guard isRunning else { return }
    isRunning = false
    stopTimer()
    removeObservers()
    stopEngine()  // 1. tap + engine first: the input I/O is released...
    AudioSessionCoordinator.shared.leaveRecording()  // 2. ...then the category goes back to .playback
    bridge.reset()
  }

  // MARK: - Engine

  private func requestPermission(_ done: @escaping (Bool) -> Void) {
    if #available(iOS 17.0, *) {
      AVAudioApplication.requestRecordPermission(completionHandler: done)
    } else {
      AVAudioSession.sharedInstance().requestRecordPermission(done)
    }
  }

  private func startEngine() throws {
    let newEngine = AVAudioEngine()
    let input = newEngine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else { throw TunerError.noInput }
    bridge.prepare(withSampleRate: format.sampleRate)
    let bridge = self.bridge
    // ~2048-sample buffers: iOS may deliver larger ones; the bridge accumulates a ~4096 window either way.
    input.installTap(onBus: 0, bufferSize: 2048, format: format) { buffer, _ in
      bridge.processBuffer(buffer)
    }
    newEngine.prepare()
    do {
      try newEngine.start()
    } catch {
      input.removeTap(onBus: 0)
      throw error
    }
    engine = newEngine
  }

  private func stopEngine() {
    guard let current = engine else { return }
    current.inputNode.removeTap(onBus: 0)
    current.stop()
    engine = nil
  }

  /// Route/format changes (headphones, Bluetooth, category switch): rebuild the input engine.
  private func restartEngine() {
    guard isRunning else { return }
    stopEngine()
    do {
      try AudioSessionCoordinator.shared.activate()
      try startEngine()
    } catch {
      // Leave it stopped; the next configuration change or stop() cleans up.
    }
  }

  // MARK: - Reporting

  private func startTimer() {
    stopTimer()
    let t = DispatchSource.makeTimerSource(queue: .main)
    t.schedule(deadline: .now() + .milliseconds(33), repeating: .milliseconds(33), leeway: .milliseconds(3))
    t.setEventHandler { [weak self] in self?.emit() }
    t.resume()
    timer = t
  }

  private func stopTimer() {
    timer?.cancel()
    timer = nil
  }

  private func emit() {
    let reading = bridge.latestReading()
    let seq = (reading["seq"] as? Int) ?? 0
    guard seq != lastSeq else { return }  // nothing new since the last tick
    lastSeq = seq
    onReading?([
      "frequency": (reading["frequency"] as? Double) ?? -1,
      "clarity": (reading["clarity"] as? Double) ?? 0,
      "rms": (reading["rms"] as? Double) ?? 0,
      "wave": ((reading["wave"] as? [NSNumber]) ?? []).map { $0.doubleValue },
    ])
  }

  // MARK: - Notifications

  private func installObservers() {
    removeObservers()
    let nc = NotificationCenter.default
    observers.append(nc.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main) { [weak self] note in
      guard let self, let changed = note.object as? AVAudioEngine, changed === self.engine else { return }
      self.restartEngine()
    })
    observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
      guard let self, self.isRunning,
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw), type == .ended else { return }
      self.restartEngine()
    })
  }

  private func removeObservers() {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers.removeAll()
  }
}
