import AVFoundation
import MediaPlayer

enum PlayerEngineError: LocalizedError {
  case invalidURL(String)
  case unitUnavailable
  case noTrack

  var errorDescription: String? {
    switch self {
    case .invalidURL(let s): return "Invalid URL: \(s)"
    case .unitUnavailable: return "Unable to create the pitch audio unit"
    case .noTrack: return "No track loaded"
    }
  }
}

/// AVAudioEngine graph: playerNode -> preMixer -> RPPitchAudioUnit -> mainMixer.
/// The pre-mixer converts any file layout (mono, 5.1...) to the stereo format the AU expects.
/// Everything here runs on the main queue.
final class PlayerEngine {
  var onProgress: ((Double, Double) -> Void)?
  var onTrackEnd: (() -> Void)?
  var onPlayedSeconds: ((Double) -> Void)?
  var onPlayingChange: ((Bool) -> Void)?
  var onRemoteNext: (() -> Void)?
  var onRemotePrevious: (() -> Void)?

  // Hooks for MetronomeEngine, which shares this engine (it plays its click through the same main mixer).
  /// True while someone besides the track needs the engine running (metronome active).
  var keepEngineRunning: (() -> Bool)?
  /// AVAudioEngineConfigurationChange: called with `false` before the engine restarts, `true` after.
  var onEngineConfigurationChange: ((Bool) -> Void)?
  /// Session interruption: (began, shouldResume).
  var onInterruption: ((Bool, Bool) -> Void)?

  let engine = AVAudioEngine()
  private let node = AVAudioPlayerNode()
  private let preMixer = AVAudioMixerNode()
  private var avUnit: AVAudioUnit?
  private var pitchUnit: RPPitchAudioUnit?

  private var file: AVAudioFile?
  private var title = ""
  private var sampleRate: Double = 44100
  private var totalFrames: AVAudioFramePosition = 0

  private var segmentStartFrame: AVAudioFramePosition = 0
  private var pausedFrame: AVAudioFramePosition = 0
  private var lastKnownFrame: AVAudioFramePosition = 0
  private var needsReschedule = true
  private var generation = 0 {
    didSet { playbackEpoch &+= 1 }
  }
  /// Bumps on every playback discontinuity: seek, (re)schedule, pause/resume, track change, engine restart.
  /// MetronomeEngine's beat follow compares it between pumps instead of guessing from timestamps.
  private(set) var playbackEpoch = 0
  /// Generation whose end-of-track was already handled (completion callback and tick fallback race).
  private var endedGeneration = -1

  private(set) var isPlaying = false
  private var resumeAfterInterruption = false
  private var semitones: Float = 0

  private var playedSeconds: Double = 0
  private var lastTickUptime: TimeInterval?
  private var timer: DispatchSourceTimer?

  private var observersInstalled = false
  private var remoteCommandsInstalled = false
  /// Loads that arrived while the pitch unit was still being instantiated (two quick `load`s in a row
  /// must not instantiate and attach two units).
  private var pitchUnitWaiters: [(Result<Void, Error>) -> Void] = []

  init() {
    engine.attach(node)
    engine.attach(preMixer)
  }

  // MARK: - Public API

  func load(uri: String, title customTitle: String? = nil, completion: @escaping (Result<Double, Error>) -> Void) {
    let url: URL
    if let u = URL(string: uri), u.scheme != nil {
      url = u
    } else {
      url = URL(fileURLWithPath: uri)
    }
    guard url.isFileURL else {
      completion(.failure(PlayerEngineError.invalidURL(uri)))
      return
    }

    ensurePitchUnit { [weak self] result in
      guard let self else { return }
      switch result {
      case .failure(let error):
        completion(.failure(error))
      case .success:
        do {
          let f = try AVAudioFile(forReading: url)
          let resolvedTitle = (customTitle?.isEmpty == false) ? customTitle! : url.deletingPathExtension().lastPathComponent
          try self.attach(file: f, title: resolvedTitle)
          completion(.success(self.duration))
        } catch {
          completion(.failure(error))
        }
      }
    }
  }

  func play() throws {
    guard file != nil else { throw PlayerEngineError.noTrack }
    installObserversIfNeeded()
    installRemoteCommandsIfNeeded()
    try startPlayback()
    notifyPlayingChange()
  }

  func pause() {
    guard isPlaying else { return }
    pausePlayback()
    emitProgress()
    notifyPlayingChange()
  }

  func seek(seconds: Double) {
    guard file != nil else { return }
    let frame = clampFrame(AVAudioFramePosition(seconds * sampleRate))
    let wasPlaying = isPlaying
    pausedFrame = frame
    lastKnownFrame = frame
    pitchUnit?.requestReset()
    if engine.isRunning || !wasPlaying {
      scheduleSegment(from: frame)
      needsReschedule = false
      if wasPlaying { node.play() }
    } else {
      needsReschedule = true
    }
    emitProgress()
    updateNowPlaying()
  }

  func setPitch(_ value: Double) {
    let v = Float(max(-24, min(24, value)))
    semitones = v
    pitchUnit?.semitones = v
  }

  func status() -> [String: Any] {
    [
      "position": position,
      "duration": duration,
      "isPlaying": isPlaying,
      "semitones": Double(semitones),
    ]
  }

  // MARK: - State

  private var duration: Double {
    sampleRate > 0 ? Double(totalFrames) / sampleRate : 0
  }

  private var position: Double {
    guard file != nil, sampleRate > 0 else { return 0 }
    return Double(currentFrame()) / sampleRate
  }

  private func clampFrame(_ f: AVAudioFramePosition) -> AVAudioFramePosition {
    max(0, min(f, totalFrames))
  }

  /// Current frame in the file. While playing it's derived from the player node's clock;
  /// when that isn't available (engine stopped) the last known value is used.
  private func currentFrame() -> AVAudioFramePosition {
    if !isPlaying { return pausedFrame }
    if let nodeTime = node.lastRenderTime,
       let playerTime = node.playerTime(forNodeTime: nodeTime) {
      lastKnownFrame = clampFrame(segmentStartFrame + playerTime.sampleTime)
    }
    return lastKnownFrame
  }

  // MARK: - Beat follow support

  /// Delay the pitch unit adds to the track (Signalsmith streaming latency), in seconds.
  var pitchLatencySeconds: Double { pitchUnit?.latencySeconds ?? 0 }

  /// A consistent (host clock, file position) pair taken from the player node's last render cycle.
  struct PlaybackSnapshot {
    let hostSeconds: Double       // AVAudioTime.seconds(forHostTime:) of that render cycle
    let fileFrame: Double         // frame in the file being rendered at that moment
    let fileSampleRate: Double
    let epoch: Int
  }

  /// Nil unless the track is playing and the node has a valid clock.
  func playbackSnapshot() -> PlaybackSnapshot? {
    guard isPlaying, file != nil, sampleRate > 0,
          let nodeTime = node.lastRenderTime, nodeTime.isHostTimeValid,
          let playerTime = node.playerTime(forNodeTime: nodeTime), playerTime.isSampleTimeValid else { return nil }
    return PlaybackSnapshot(
      hostSeconds: AVAudioTime.seconds(forHostTime: nodeTime.hostTime),
      fileFrame: Double(segmentStartFrame) + Double(playerTime.sampleTime),
      fileSampleRate: playerTime.sampleRate > 0 ? playerTime.sampleRate : sampleRate,
      epoch: playbackEpoch)
  }

  /// Position in the file (seconds) that is *audible at the speaker* at host time `h` (mach seconds, same clock as
  /// AVAudioTime.seconds(forHostTime:)): the render-cycle snapshot extrapolated to `h`, minus the output path
  /// (hardware + IO buffer) and the pitch unit's latency. Nil when not playing. Used to place user taps on the track.
  func audibleFileSeconds(atHostSeconds h: Double) -> Double? {
    guard let snap = playbackSnapshot() else { return nil }
    let session = AVAudioSession.sharedInstance()
    let renderedSeconds = (snap.fileFrame + (h - snap.hostSeconds) * snap.fileSampleRate) / snap.fileSampleRate
    return renderedSeconds - (session.outputLatency + session.ioBufferDuration) - pitchLatencySeconds
  }

  // MARK: - Graph

  private func ensurePitchUnit(_ done: @escaping (Result<Void, Error>) -> Void) {
    if pitchUnit != nil {
      done(.success(()))
      return
    }
    pitchUnitWaiters.append(done)
    if pitchUnitWaiters.count > 1 { return }  // an instantiation is already in flight
    RPPitchAudioUnit.registerOnce()
    AVAudioUnit.instantiate(
      with: RPPitchAudioUnit.componentDescription(),
      options: []  // registered subclasses are always in-process on iOS
    ) { [weak self] unit, error in
      DispatchQueue.main.async {
        guard let self else { return }
        let waiters = self.pitchUnitWaiters
        self.pitchUnitWaiters.removeAll()
        guard let unit, let au = unit.auAudioUnit as? RPPitchAudioUnit else {
          waiters.forEach { $0(.failure(error ?? PlayerEngineError.unitUnavailable)) }
          return
        }
        au.semitones = self.semitones
        self.avUnit = unit
        self.pitchUnit = au
        self.engine.attach(unit)
        waiters.forEach { $0(.success(())) }
      }
    }
  }

  private func attach(file newFile: AVAudioFile, title newTitle: String) throws {
    // Tear down the current playback.
    generation += 1
    node.stop()
    if isPlaying {
      accruePlayedTime()
      isPlaying = false
      stopTimer()
      notifyPlayingChange()
    }
    let keepAlive = keepEngineRunning?() ?? false
    engine.stop()

    guard let unit = avUnit else { throw PlayerEngineError.unitUnavailable }

    file = newFile
    title = newTitle
    sampleRate = newFile.processingFormat.sampleRate
    totalFrames = newFile.length
    segmentStartFrame = 0
    pausedFrame = 0
    lastKnownFrame = 0
    needsReschedule = true

    guard let stereo = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2) else {
      throw PlayerEngineError.unitUnavailable
    }
    engine.disconnectNodeOutput(node)
    engine.disconnectNodeOutput(preMixer)
    engine.disconnectNodeOutput(unit)
    engine.connect(node, to: preMixer, format: newFile.processingFormat)
    engine.connect(preMixer, to: unit, format: stereo)
    engine.connect(unit, to: engine.mainMixerNode, format: stereo)
    engine.prepare()
    // The metronome keeps clicking across a track change: bring the engine back up.
    if keepAlive { try? engine.start() }

    pitchUnit?.requestReset()
    updateNowPlaying()
  }

  private func scheduleSegment(from frame: AVAudioFramePosition) {
    guard let file else { return }
    generation += 1
    let gen = generation
    node.stop()
    segmentStartFrame = frame
    let remaining = totalFrames - frame
    guard remaining > 0 else { return }
    node.scheduleSegment(
      file,
      startingFrame: frame,
      frameCount: AVAudioFrameCount(remaining),
      at: nil,
      completionCallbackType: .dataPlayedBack
    ) { [weak self] _ in
      DispatchQueue.main.async { self?.handleSegmentCompletion(generation: gen) }
    }
  }

  // MARK: - Playback control

  private func startPlayback() throws {
    try AudioSessionCoordinator.shared.activate()  // keeps .playAndRecord while the tuner is listening

    if !engine.isRunning {
      try engine.start()
      needsReschedule = true
    }
    if pausedFrame >= totalFrames {
      pausedFrame = 0
      lastKnownFrame = 0
      needsReschedule = true
      pitchUnit?.requestReset()
    }
    if needsReschedule {
      scheduleSegment(from: pausedFrame)
      needsReschedule = false
    }
    node.play()
    isPlaying = true
    playbackEpoch &+= 1
    lastTickUptime = ProcessInfo.processInfo.systemUptime
    startTimer()
    updateNowPlaying()
  }

  private func pausePlayback() {
    let frame = currentFrame()
    node.pause()
    playbackEpoch &+= 1
    accruePlayedTime()
    isPlaying = false
    pausedFrame = frame
    lastKnownFrame = frame
    stopTimer()
    updateNowPlaying()
  }

  private func handleSegmentCompletion(generation gen: Int) {
    guard gen == generation, isPlaying else { return }
    finishTrack()
  }

  /// End of track: runs once per generation, from the completion callback or the tick fallback.
  private func finishTrack() {
    guard endedGeneration != generation else { return }
    endedGeneration = generation
    accruePlayedTime()
    isPlaying = false
    stopTimer()
    node.stop()
    pausedFrame = totalFrames
    lastKnownFrame = totalFrames
    needsReschedule = true
    emitProgress()
    onPlayedSeconds?(playedSeconds)
    updateNowPlaying()
    notifyPlayingChange()
    onTrackEnd?()
  }

  // MARK: - Timer / counters

  private func startTimer() {
    stopTimer()
    let t = DispatchSource.makeTimerSource(queue: .main)
    t.schedule(deadline: .now() + 0.25, repeating: 0.25)
    t.setEventHandler { [weak self] in self?.tick() }
    t.resume()
    timer = t
  }

  private func stopTimer() {
    timer?.cancel()
    timer = nil
  }

  private func accruePlayedTime() {
    guard let last = lastTickUptime else { return }
    let now = ProcessInfo.processInfo.systemUptime
    playedSeconds += max(0, now - last)
    lastTickUptime = isPlaying ? now : nil
  }

  private func tick() {
    guard isPlaying else { return }
    // Fallback: `.dataPlayedBack` is sometimes late or dropped, so detect the end from the node clock.
    if let nodeTime = node.lastRenderTime,
       let playerTime = node.playerTime(forNodeTime: nodeTime),
       segmentStartFrame + playerTime.sampleTime >= totalFrames + AVAudioFramePosition(0.15 * sampleRate) {
      finishTrack()
      return
    }
    accruePlayedTime()
    emitProgress()
    onPlayedSeconds?(playedSeconds)
  }

  private func emitProgress() {
    onProgress?(position, duration)
  }

  private func notifyPlayingChange() {
    onPlayingChange?(isPlaying)
  }

  // MARK: - System notifications

  func ensureObservers() { installObserversIfNeeded() }

  private func installObserversIfNeeded() {
    guard !observersInstalled else { return }
    observersInstalled = true
    let nc = NotificationCenter.default
    nc.addObserver(self, selector: #selector(handleInterruption(_:)),
                   name: AVAudioSession.interruptionNotification, object: nil)
    nc.addObserver(self, selector: #selector(handleRouteChange(_:)),
                   name: AVAudioSession.routeChangeNotification, object: nil)
    nc.addObserver(self, selector: #selector(handleConfigurationChange(_:)),
                   name: .AVAudioEngineConfigurationChange, object: engine)
  }

  @objc private func handleInterruption(_ note: Notification) {
    DispatchQueue.main.async { [self] in
      guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
      switch type {
      case .began:
        onInterruption?(true, false)
        resumeAfterInterruption = isPlaying
        if isPlaying {
          pausePlayback()
          emitProgress()
          notifyPlayingChange()
        }
      case .ended:
        let optRaw = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
        let shouldResume = AVAudioSession.InterruptionOptions(rawValue: optRaw).contains(.shouldResume)
        let wasPlaying = resumeAfterInterruption
        resumeAfterInterruption = false
        defer { onInterruption?(false, shouldResume) }
        if shouldResume && wasPlaying {
          // The engine may have been stopped by the system: startPlayback restarts and reschedules.
          if (try? startPlayback()) != nil { notifyPlayingChange() }
        }
      @unknown default:
        break
      }
    }
  }

  @objc private func handleRouteChange(_ note: Notification) {
    DispatchQueue.main.async { [self] in
      guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
            let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
      if reason == .oldDeviceUnavailable { pause() }
    }
  }

  @objc private func handleConfigurationChange(_ note: Notification) {
    DispatchQueue.main.async { [self] in
      onEngineConfigurationChange?(false)  // metronome: re-prepare its node for the new output rate
      defer {
        // The metronome needs the engine even with no track (or a paused one).
        if keepEngineRunning?() == true && !engine.isRunning { try? engine.start() }
        onEngineConfigurationChange?(true)
      }
      guard file != nil else { return }
      // The engine has stopped and the player node lost its scheduled audio.
      let wasPlaying = isPlaying
      let frame = lastKnownFrame
      generation += 1
      pausedFrame = wasPlaying ? frame : pausedFrame
      needsReschedule = true
      if wasPlaying {
        accruePlayedTime()
        isPlaying = false
        stopTimer()
        if (try? startPlayback()) == nil { notifyPlayingChange() }
      }
    }
  }

  // MARK: - Now Playing / remote commands

  private func updateNowPlaying() {
    guard file != nil else { return }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = [
      MPMediaItemPropertyTitle: title,
      MPMediaItemPropertyPlaybackDuration: duration,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
      MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
      MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
    ]
  }

  private func installRemoteCommandsIfNeeded() {
    guard !remoteCommandsInstalled else { return }
    remoteCommandsInstalled = true
    let center = MPRemoteCommandCenter.shared()

    center.playCommand.isEnabled = true
    center.playCommand.addTarget { [weak self] _ in
      DispatchQueue.main.async { try? self?.play() }
      return .success
    }
    center.pauseCommand.isEnabled = true
    center.pauseCommand.addTarget { [weak self] _ in
      DispatchQueue.main.async { self?.pause() }
      return .success
    }
    center.togglePlayPauseCommand.isEnabled = true
    center.togglePlayPauseCommand.addTarget { [weak self] _ in
      DispatchQueue.main.async {
        guard let self else { return }
        if self.isPlaying { self.pause() } else { try? self.play() }
      }
      return .success
    }
    center.changePlaybackPositionCommand.isEnabled = true
    center.changePlaybackPositionCommand.addTarget { [weak self] event in
      guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
      let t = e.positionTime
      DispatchQueue.main.async { self?.seek(seconds: t) }
      return .success
    }
    center.nextTrackCommand.isEnabled = true
    center.nextTrackCommand.addTarget { [weak self] _ in
      DispatchQueue.main.async { self?.onRemoteNext?() }
      return .success
    }
    center.previousTrackCommand.isEnabled = true
    center.previousTrackCommand.addTarget { [weak self] _ in
      DispatchQueue.main.async { self?.onRemotePrevious?() }
      return .success
    }
  }
}
