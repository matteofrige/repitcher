import AVFoundation

/// Reference tone for the tuner: a SEPARATE AVAudioEngine with one AVAudioSourceNode (additive "organ" tone),
/// so neither the playback engine nor the tuner's input engine is touched.
///
/// The render block only reads/writes a heap-allocated state struct through a raw pointer (no allocation, no
/// locks, no Swift runtime objects on the audio thread); the main thread writes the targets (aligned Doubles).
/// The session goes through AudioSessionCoordinator, so while the tuner records (.playAndRecord +
/// .defaultToSpeaker) the tone comes out of the speaker. The session is never deactivated here.
/// Main thread only.
final class ToneEngine {
  private struct State {
    var phase: Double = 0
    var currentFreq: Double = 440
    var targetFreq: Double = 440
    var currentGain: Double = 0
    var targetGain: Double = 0
    var sampleRate: Double = 48000
  }

  private static let maxGain = 0.98  // the waveform peaks below 1: no clipping
  private static let fadeIn = 0.020  // seconds
  private static let fadeOut = 0.040
  private static let freqSmoothing = 0.010

  private let state: UnsafeMutablePointer<State>
  private var engine: AVAudioEngine?
  private var isRunning = false
  private var generation = 0  // bumped by start(): invalidates a pending stop()
  private var observers: [NSObjectProtocol] = []

  init() {
    state = UnsafeMutablePointer<State>.allocate(capacity: 1)
    state.initialize(to: State())
  }

  deinit {
    removeObservers()
    engine?.stop()
    state.deinitialize(count: 1)
    state.deallocate()
  }

  func start(frequency: Double, volume: Double) throws {
    let freq = min(5000, max(20, frequency))
    let gain = Self.maxGain * min(1, max(0, volume))
    generation += 1  // cancels a pending stop
    if isRunning {
      state.pointee.targetFreq = freq
      state.pointee.targetGain = gain
      return
    }
    try AudioSessionCoordinator.shared.activate()
    state.pointee.currentGain = 0
    state.pointee.currentFreq = freq
    state.pointee.targetFreq = freq
    state.pointee.targetGain = gain
    try startEngine()
    isRunning = true
    installObservers()
  }

  func stop() {
    guard isRunning else { return }
    state.pointee.targetGain = 0
    generation += 1
    let token = generation
    // Let the fade-out (40 ms) finish before the engine goes away.
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(60)) { [weak self] in
      guard let self, self.generation == token else { return }
      self.shutdown()
    }
  }

  // MARK: - Engine

  private func startEngine() throws {
    let newEngine = AVAudioEngine()
    let hwRate = newEngine.outputNode.outputFormat(forBus: 0).sampleRate
    let sampleRate = hwRate > 0 ? hwRate : 48000
    state.pointee.sampleRate = sampleRate
    guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1) else {
      throw NSError(domain: "ToneEngine", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported audio format"])
    }
    let st = state
    let node = AVAudioSourceNode(format: format) { _, _, frameCount, audioBufferList -> OSStatus in
      let abl = UnsafeMutableAudioBufferListPointer(audioBufferList)
      let sr = st.pointee.sampleRate
      let freqCoef = 1 - exp(-1 / (ToneEngine.freqSmoothing * sr))
      let upStep = ToneEngine.maxGain / (ToneEngine.fadeIn * sr)
      let downStep = ToneEngine.maxGain / (ToneEngine.fadeOut * sr)
      var phase = st.pointee.phase
      var freq = st.pointee.currentFreq
      var gain = st.pointee.currentGain
      let targetFreq = st.pointee.targetFreq
      let targetGain = st.pointee.targetGain
      let twoPi = 2 * Double.pi
      for frame in 0..<Int(frameCount) {
        freq += (targetFreq - freq) * freqCoef
        if gain < targetGain {
          gain = min(targetGain, gain + upStep)
        } else if gain > targetGain {
          gain = max(targetGain, gain - downStep)
        }
        let s = (sin(phase) + 0.5 * sin(2 * phase) + 0.3 * sin(3 * phase)) / 1.8
        let out = Float(s * gain)
        for buffer in abl {
          buffer.mData?.assumingMemoryBound(to: Float.self)[frame] = out
        }
        phase += twoPi * freq / sr
        if phase >= twoPi { phase -= twoPi }
      }
      st.pointee.phase = phase
      st.pointee.currentFreq = freq
      st.pointee.currentGain = gain
      return noErr
    }
    newEngine.attach(node)
    newEngine.connect(node, to: newEngine.mainMixerNode, format: format)
    newEngine.prepare()
    try newEngine.start()
    engine = newEngine
  }

  private func stopEngine() {
    engine?.stop()
    engine = nil
  }

  private func shutdown() {
    isRunning = false
    removeObservers()
    stopEngine()
    state.pointee.currentGain = 0
    state.pointee.targetGain = 0
  }

  /// Route/format changes (headphones, Bluetooth, category switch): rebuild the engine.
  private func restartEngine() {
    guard isRunning else { return }
    stopEngine()
    do {
      try AudioSessionCoordinator.shared.activate()
      try startEngine()
    } catch {
      shutdown()  // leave it stopped; the next start() rebuilds everything
    }
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
            let type = AVAudioSession.InterruptionType(rawValue: raw), type == .began else { return }
      self.shutdown()
    })
  }

  private func removeObservers() {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers.removeAll()
  }
}
