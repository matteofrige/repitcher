import AVFoundation

/// Metronome on the SAME AVAudioEngine as PlayerEngine: an AVAudioSourceNode (mono Float32 at the
/// mixer's output sample rate, so no SRC in the click path) feeding the main mixer. It therefore plays
/// over a track, and pausing the track never stops it (nor vice-versa).
///
/// Timing lives entirely in the C++ core (frame counting on the audio thread). The only thing the main
/// thread does is *report* beats to JS:
///  - the core stamps each click with the render block's host time + frame offset;
///  - a ~125 Hz main-queue timer drains those events and emits `onMetronomeBeat` when
///    `hostTime + offset + outputLatency + ioBufferDuration` has arrived, i.e. when the click actually
///    leaves the speaker (not when it was rendered, which is a buffer + output latency earlier).
/// Choice: render-block host time rather than a frame-count estimate, because it stays exact across
/// stalls/underruns of the main thread and across engine restarts.
/// Main thread only.
final class MetronomeEngine {
  var onBeat: ((Int, Bool) -> Void)?
  private(set) var isActive = false

  private let player: PlayerEngine
  private let core = RPMetronome()
  private var sourceNode: AVAudioSourceNode?
  private var preparedRate: Double = 0

  private struct PendingBeat { let due: Double; let beat: Int; let accent: Bool }
  private var pending: [PendingBeat] = []
  private var timer: DispatchSourceTimer?
  private var latency: Double = 0
  private var latencyStamp: Double = 0
  private var resumeAfterInterruption = false

  init(player: PlayerEngine) {
    self.player = player
    core.configure(withBpm: 100, beatsPerBar: 4, volume: 0.8)
    player.keepEngineRunning = { [weak self] in self?.isActive ?? false }
    player.onEngineConfigurationChange = { [weak self] afterRestart in self?.handleConfigurationChange(afterRestart: afterRestart) }
    player.onInterruption = { [weak self] began, shouldResume in self?.handleInterruption(began: began, shouldResume: shouldResume) }
  }

  func configure(bpm: Double, beatsPerBar: Int, volume: Double) {
    core.configure(withBpm: bpm, beatsPerBar: beatsPerBar, volume: volume)
  }

  func start() throws {
    if isActive { return }
    player.ensureObservers()
    // Session first: the hardware sample rate is only known once it's active.
    try AudioSessionCoordinator.shared.activate()
    rebuildNodeIfNeeded()
    let engine = player.engine
    if !engine.isRunning {
      engine.prepare()
      try engine.start()
    }
    _ = core.drainBeats(withLatency: 0)  // drop leftovers of a previous run
    pending.removeAll()
    core.start()
    isActive = true
    startTimer()
  }

  func stop() {
    guard isActive else { return }
    core.stop()
    isActive = false
    resumeAfterInterruption = false
    stopTimer()
    pending.removeAll()
    // Nothing else needs the engine: stop it. PlayerEngine.startPlayback restarts it and reschedules.
    if !player.isPlaying { player.engine.stop() }
  }

  // MARK: - Graph

  private func mixerRate() -> Double {
    var sr = player.engine.mainMixerNode.outputFormat(forBus: 0).sampleRate
    if sr <= 0 { sr = AVAudioSession.sharedInstance().sampleRate }
    return sr > 0 ? sr : 48000
  }

  /// (Re)creates the source node when the output rate changed or it doesn't exist yet.
  private func rebuildNodeIfNeeded() {
    let sr = mixerRate()
    if sourceNode != nil && sr == preparedRate { return }
    let engine = player.engine
    if let old = sourceNode {
      engine.detach(old)  // before core.prepare: the old render block must stop touching the core
      sourceNode = nil
    }
    let node = core.makeSourceNode(withSampleRate: sr)
    engine.attach(node)
    engine.connect(node, to: engine.mainMixerNode, format: node.outputFormat(forBus: 0))
    sourceNode = node
    preparedRate = sr
  }

  // MARK: - System events (forwarded by PlayerEngine, which owns the engine observers)

  /// Called by PlayerEngine on AVAudioEngineConfigurationChange: first with the engine stopped (re-prepare the
  /// node for the new output rate), then again after PlayerEngine has restarted the engine (verify the rate).
  private func handleConfigurationChange(afterRestart: Bool) {
    guard sourceNode != nil else { return }
    if !afterRestart || player.engine.isRunning { rebuildNodeIfNeeded() }
  }

  private func handleInterruption(began: Bool, shouldResume: Bool) {
    if began {
      guard isActive else { return }
      resumeAfterInterruption = true
      core.stop()
      isActive = false
      stopTimer()
      pending.removeAll()
    } else {
      let resume = resumeAfterInterruption && shouldResume
      resumeAfterInterruption = false
      if resume { try? start() }
    }
  }

  // MARK: - Beat reporting

  private func startTimer() {
    stopTimer()
    let t = DispatchSource.makeTimerSource(queue: .main)
    t.schedule(deadline: .now(), repeating: .milliseconds(8), leeway: .milliseconds(1))
    t.setEventHandler { [weak self] in self?.pump() }
    t.resume()
    timer = t
  }

  private func stopTimer() {
    timer?.cancel()
    timer = nil
  }

  private func pump() {
    let now = AVAudioTime.seconds(forHostTime: mach_absolute_time())
    if now - latencyStamp > 0.25 {  // the route can change: refresh a few times per second
      let session = AVAudioSession.sharedInstance()
      latency = session.outputLatency + session.ioBufferDuration
      latencyStamp = now
    }
    for item in core.drainBeats(withLatency: latency) {
      guard let due = item["due"] as? Double, let beat = item["beat"] as? Int else { continue }
      pending.append(PendingBeat(due: due, beat: beat, accent: (item["accent"] as? Bool) ?? false))
    }
    while let first = pending.first, first.due <= now {
      pending.removeFirst()
      if now - first.due < 1.0 { onBeat?(first.beat, first.accent) }  // drop stale beats instead of bursting
    }
  }
}
