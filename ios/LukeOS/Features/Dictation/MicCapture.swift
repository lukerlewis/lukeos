import AVFoundation

/// Listens to the microphone and keeps what was said as 16 kHz mono samples, the form Whisper reads.
/// The audio arrives on the system's audio thread, so this guards its own state with a lock.
final class MicCapture: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let lock = NSLock()
    private var samples: [Float] = []
    private var keeping = false
    private var converter: AVAudioConverter?
    private let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!
    /// Five minutes at 16 kHz: the most one dictation keeps.
    private let limit = 16_000 * 60 * 5

    enum Failure: Error { case noMicrophone }

    var isRunning: Bool { engine.isRunning }

    /// Turns the microphone on. Nothing is kept until `begin()`.
    func start() throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw Failure.noMicrophone }
        converter = AVAudioConverter(from: format, to: target)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            self?.take(buffer)
        }
        engine.prepare()
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        _ = end()
    }

    /// Starts keeping what is said.
    func begin() {
        lock.lock()
        samples.removeAll(keepingCapacity: true)
        keeping = true
        lock.unlock()
    }

    /// Stops keeping and hands back what was said.
    func end() -> [Float] {
        lock.lock()
        defer { lock.unlock() }
        keeping = false
        let out = samples
        samples = []
        return out
    }

    private func take(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        let wanted = keeping && samples.count < limit
        lock.unlock()
        guard wanted, let converter, buffer.frameLength > 0 else { return }

        let ratio = target.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }

        let fed = Flag()
        nonisolated(unsafe) let source = buffer
        var failure: NSError?
        converter.convert(to: out, error: &failure) { _, status in
            if fed.value {
                status.pointee = .noDataNow
                return nil
            }
            fed.value = true
            status.pointee = .haveData
            return source
        }
        guard failure == nil, out.frameLength > 0, let channel = out.floatChannelData else { return }
        let chunk = Array(UnsafeBufferPointer(start: channel[0], count: Int(out.frameLength)))
        lock.lock()
        if keeping { samples.append(contentsOf: chunk) }
        lock.unlock()
    }

    private final class Flag: @unchecked Sendable { var value = false }
}
