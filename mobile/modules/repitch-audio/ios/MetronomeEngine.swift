import AVFoundation

/// Metronome on the SAME AVAudioEngine as PlayerEngine: an AVAudioSourceNode (mono Float32 at the
/// mixer's output sample rate, so no SRC in the click path) feeding the main mixer. It therefore plays
/// over a track, and pausing the track never stops it (nor vice-versa).
///
/// Timing lives entirely in the C++ core (frame counting on the audio thread). The only thing the main
/// thread does is *report* beats to JS:
///  - the core stamps each click with the render block's host time + frame offset;
///  - a ~125 Hz main-queue timer drains those events and emits `onMetronomeBeat` right away (a buffer or so
///    ahead of the sound) with `atMs`: the epoch time (JS `Date.now()` clock) at which
///    `hostTime + offset + outputLatency + ioBufferDuration` arrives, i.e. when the click leaves the speaker.
///    JS schedules the visuals on that timestamp instead of reacting after the fact.
/// Choice: render-block host time rather than a frame-count estimate, because it stays exact across
/// stalls/underruns of the main thread and across engine restarts.
///
/// Beat follow (`startFollow`): the same source node plays clicks on the beats of the *track* instead of a
/// fixed tempo. The pump looks ~350 ms ahead at the player's clock (host time + file frame of its last render
/// cycle), converts each upcoming beat to a core frame (host time → core frame through the last render block,
/// plus the pitch unit's latency) and schedules it sample-accurately; JS gets the event at scheduling time,
/// with the same `atMs` convention, so it has ~300 ms of lead for the flash.
///
/// Count-in (`playWithCountIn`): before the track starts, N clicks (force-audible even if the follow click is
/// off) are queued on the host clock, extending the beat grid backwards; the player node is started with
/// `play(at:)` so the track begins on the entry beat. The pump queues the count-in first and only then hands
/// over to the regular follow, without a resync (which would clear the pending clicks).
/// Main thread only.
final class MetronomeEngine {
  /// (beat in bar, accent, atMs, follow)
  var onBeat: ((Int, Bool, Double, Bool) -> Void)?
  private(set) var isActive = false
  private(set) var isFollowing = false

  private let player: PlayerEngine
  private let core = RPMetronome()
  private var sourceNode: AVAudioSourceNode?
  private var preparedRate: Double = 0

  private var timer: DispatchSourceTimer?
  private var latency: Double = 0
  private var latencyStamp: Double = 0
  private var resumeAfterInterruption = false

  // Beat follow state
  private var followBeats: [Double] = []
  private var followBeatsPerBar = 4
  private var followDownbeat = 0
  private var followClickAudible = true
  private var followVolume = 0.8
  private var followNextBeat = 0
  private var followEpoch: Int?
  private var followLastHost = 0.0
  private var followLastFrame = 0.0
  private var resumeFollowAfterInterruption = false
  private let followLookAhead = 0.35
  private let followLateTolerance = 0.02
  private let followJumpTolerance = 0.05

  // Count-in state
  private struct CountInClick { let host: Double; let inBar: Int; let force: Bool }
  private var countIn: [CountInClick] = []
  private var countInNext = 0
  private var countInEpoch = 0
  private let countInLead = 0.15

  init(player: PlayerEngine) {
    self.player = player
    core.configure(withBpm: 100, beatsPerBar: 4, volume: 0.8)
    player.keepEngineRunning = { [weak self] in (self?.isActive ?? false) || (self?.isFollowing ?? false) }
    player.onEngineConfigurationChange = { [weak self] afterRestart in self?.handleConfigurationChange(afterRestart: afterRestart) }
    player.onInterruption = { [weak self] began, shouldResume in self?.handleInterruption(began: began, shouldResume: shouldResume) }
  }

  func configure(bpm: Double, beatsPerBar: Int, volume: Double) {
    core.configure(withBpm: bpm, beatsPerBar: beatsPerBar, volume: volume)
  }

  private func bringUpEngine() throws {
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
  }

  func start() throws {
    if isActive { return }
    if isFollowing { stopFollow() }  // mutually exclusive with beat follow
    try bringUpEngine()
    core.setFollow(false, clickAudible: true)
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
    // Nothing else needs the engine: stop it. PlayerEngine.startPlayback restarts it and reschedules.
    if !player.isPlaying { player.engine.stop() }
  }

  // MARK: - Beat follow

  func startFollow(beats: [Double], beatsPerBar: Int, downbeatIndex: Int, clickAudible: Bool, volume: Double) throws {
    if isActive { stop() }  // mutually exclusive with the fixed-tempo metronome
    followBeats = beats
    followBeatsPerBar = max(1, beatsPerBar)
    followDownbeat = max(0, downbeatIndex)
    followClickAudible = clickAudible
    followVolume = volume
    if isFollowing {
      // New beats (e.g. track change) on a running follow: just resync.
      core.configureFollow(withBeatsPerBar: followBeatsPerBar, volume: followVolume)
      core.setFollow(true, clickAudible: clickAudible)
      resetFollowCursor()
      return
    }
    try bringUpEngine()
    core.stop()
    core.configureFollow(withBeatsPerBar: followBeatsPerBar, volume: followVolume)
    core.setFollow(true, clickAudible: clickAudible)
    core.clearScheduled()
    resetFollowCursor()
    isFollowing = true
    startTimer()
  }

  func updateFollowOptions(clickAudible: Bool, beatsPerBar: Int, downbeatIndex: Int, volume: Double) {
    followClickAudible = clickAudible
    followBeatsPerBar = max(1, beatsPerBar)
    followDownbeat = max(0, downbeatIndex)
    followVolume = volume
    guard isFollowing else { return }
    core.configureFollow(withBeatsPerBar: followBeatsPerBar, volume: volume)
    core.setFollow(true, clickAudible: clickAudible)
  }

  /// Starts the track after a count-in. `times` are file-time seconds (may precede the current position), the last
  /// one being the entry beat; earlier ones are count-in clicks. `inBars` holds each item's bar position.
  func playWithCountIn(times: [Double], inBars: [Int]) throws {
    guard isFollowing, !times.isEmpty, times.count == inBars.count, !player.isPlaying else {
      try player.play()
      return
    }
    if !player.engine.isRunning { try bringUpEngine() }
    let p = player.startPositionSeconds
    let lat = player.pitchLatencySeconds
    let now = AVAudioTime.seconds(forHostTime: mach_absolute_time())
    // Host time at which the node starts rendering frame p; a click for file time t renders at start + (t - p) + lat.
    let start = now + countInLead + max(0, (p - times[0]) - lat)
    cancelCountIn()
    countIn = times.enumerated().map { i, t in
      CountInClick(host: start + (t - p) + lat, inBar: inBars[i], force: i < times.count - 1)
    }
    countInNext = 0
    do {
      try player.play(atHostSeconds: start)
    } catch {
      countIn = []
      throw error
    }
    countInEpoch = player.playbackEpoch
    // Regular beats resume after the entry beat.
    followEpoch = nil
    followNextBeat = firstBeat(atOrAfter: times[times.count - 1] + 0.001)
  }

  private func cancelCountIn() {
    if !countIn.isEmpty { core.clearScheduled() }
    countIn = []
    countInNext = 0
  }

  func stopFollow() {
    guard isFollowing else { return }
    cancelCountIn()
    core.clearScheduled()
    core.setFollow(false, clickAudible: true)
    isFollowing = false
    resumeFollowAfterInterruption = false
    followBeats = []
    stopTimer()
    if !player.isPlaying && !isActive { player.engine.stop() }
  }

  private func resetFollowCursor() {
    cancelCountIn()
    followEpoch = nil
    followNextBeat = 0
  }

  /// First beat index whose time is >= t.
  private func firstBeat(atOrAfter t: Double) -> Int {
    var lo = 0, hi = followBeats.count
    while lo < hi {
      let mid = (lo + hi) / 2
      if followBeats[mid] < t { lo = mid + 1 } else { hi = mid }
    }
    return lo
  }

  private func followPump(now: Double, epochMs: Double) {
    _ = core.drainBeats(withLatency: 0)  // internal events are unused: follow reports at scheduling time
    if !countIn.isEmpty {
      if !player.isPlaying || player.playbackEpoch != countInEpoch {
        // Paused or seeked during the count-in: the regular follow (resync below) takes over.
        cancelCountIn()
        followEpoch = nil
      } else {
        while countInNext < countIn.count {
          let c = countIn[countInNext]
          if c.host - now > followLookAhead { break }
          let accent = c.inBar == 0
          if !core.scheduleClick(atHostSeconds: c.host, accent: accent, beat: c.inBar, forceAudible: c.force) { return }  // retry next pump
          countInNext += 1
          onBeat?(c.inBar, accent, epochMs + (c.host + latency - now) * 1000, true)
        }
        // Regular beats only once the whole count-in is queued (the core queue must stay in ascending order).
        if countInNext < countIn.count { return }
        guard let snap = player.playbackSnapshot() else { return }  // track not rendering yet
        // Hand over without a resync (it would clear the count-in clicks still pending).
        followEpoch = snap.epoch
        followLastHost = snap.hostSeconds
        followLastFrame = snap.fileFrame
        countIn = []
        countInNext = 0
      }
    }
    guard let snap = player.playbackSnapshot() else {
      if followEpoch != nil {  // paused / stopped / engine down
        core.clearScheduled()
        followEpoch = nil
      }
      return
    }
    var resync = followEpoch != snap.epoch
    if !resync {
      let expected = followLastFrame + (snap.hostSeconds - followLastHost) * snap.fileSampleRate
      if abs(expected - snap.fileFrame) / snap.fileSampleRate > followJumpTolerance { resync = true }
    }
    followLastHost = snap.hostSeconds
    followLastFrame = snap.fileFrame
    let fileTime = snap.fileFrame / snap.fileSampleRate
    if resync {
      core.clearScheduled()
      followEpoch = snap.epoch
      followNextBeat = firstBeat(atOrAfter: fileTime - followLateTolerance)
    }
    let pitchLatency = player.pitchLatencySeconds
    while followNextBeat < followBeats.count {
      let i = followNextBeat
      let dt = followBeats[i] - fileTime
      if dt > followLookAhead { break }
      if dt < -followLateTolerance { followNextBeat += 1; continue }
      let beatHost = snap.hostSeconds + dt + pitchLatency
      // Bar position counted from the user-chosen downbeat (can be negative before it).
      let inBar = ((i - followDownbeat) % followBeatsPerBar + followBeatsPerBar) % followBeatsPerBar
      let accent = inBar == 0
      if !core.scheduleClick(atHostSeconds: beatHost, accent: accent, beat: inBar, forceAudible: false) { break }  // retry next pump
      followNextBeat += 1
      onBeat?(inBar, accent, epochMs + (beatHost + latency - now) * 1000, true)
    }
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
    if isFollowing { resetFollowCursor() }  // the rebuilt node starts from scratch: reschedule
    if !afterRestart || player.engine.isRunning { rebuildNodeIfNeeded() }
  }

  private func handleInterruption(began: Bool, shouldResume: Bool) {
    if began {
      cancelCountIn()
      if isFollowing {
        let beats = followBeats
        resumeFollowAfterInterruption = true
        stopFollow()
        followBeats = beats
        resumeFollowAfterInterruption = true
        return
      }
      guard isActive else { return }
      resumeAfterInterruption = true
      core.stop()
      isActive = false
      stopTimer()
    } else {
      if resumeFollowAfterInterruption {
        resumeFollowAfterInterruption = false
        if shouldResume {
          try? startFollow(beats: followBeats, beatsPerBar: followBeatsPerBar, downbeatIndex: followDownbeat, clickAudible: followClickAudible, volume: followVolume)
        }
        return
      }
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
    let epochMs = Date().timeIntervalSince1970 * 1000
    if isFollowing {
      followPump(now: now, epochMs: epochMs)
      return
    }
    for item in core.drainBeats(withLatency: latency) {
      guard let due = item["due"] as? Double, let beat = item["beat"] as? Int else { continue }
      if due < now - 1.0 { continue }  // drop stale beats instead of bursting
      onBeat?(beat, (item["accent"] as? Bool) ?? false, epochMs + (due - now) * 1000, false)
    }
  }
}
