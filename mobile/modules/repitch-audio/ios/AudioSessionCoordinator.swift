import AVFoundation

/// Single owner of the AVAudioSession category, so playback, metronome and tuner never fight over it.
/// While the tuner is recording the category stays .playAndRecord even if playback (re)activates the session.
/// Main thread only.
final class AudioSessionCoordinator {
  static let shared = AudioSessionCoordinator()

  private(set) var recordingActive = false

  /// Activates the session with the category matching the current state.
  func activate() throws {
    let session = AVAudioSession.sharedInstance()
    if recordingActive {
      // .measurement turns off AGC and voice processing; mixWithOthers keeps our own playback going.
      try session.setCategory(
        .playAndRecord,
        mode: .measurement,
        options: [.defaultToSpeaker, .allowBluetoothA2DP, .mixWithOthers]
      )
    } else {
      try session.setCategory(.playback, mode: .default)
    }
    try session.setActive(true)
  }

  func enterRecording() throws {
    recordingActive = true
    do {
      try activate()
    } catch {
      recordingActive = false
      throw error
    }
  }

  /// Back to .playback/.default. The session is NOT deactivated, so ongoing playback is not interrupted.
  func leaveRecording() {
    guard recordingActive else { return }
    recordingActive = false
    try? activate()
  }
}
