import AVFoundation
import CoreML
import Observation
@preconcurrency import WhisperKit

/// The Whisper models Luke can pick. All run on the iPhone; nothing is sent anywhere.
enum DictationModel: String, CaseIterable, Identifiable, Sendable {
    case fast, balanced, best

    var id: String { rawValue }

    var title: String {
        switch self {
        case .fast: "Fast"
        case .balanced: "Balanced"
        case .best: "Most accurate"
        }
    }

    /// How much room the download takes.
    var size: String {
        switch self {
        case .fast: "150 MB"
        case .balanced: "480 MB"
        case .best: "630 MB"
        }
    }

    /// The model's name in the WhisperKit library (all three are supported on the iPhone 14's A15 chip).
    var variant: String {
        switch self {
        case .fast: "openai_whisper-base.en"
        case .balanced: "openai_whisper-small.en"
        case .best: "openai_whisper-large-v3-v20240930_turbo_632MB"
        }
    }
}

/// Holds the loaded Whisper model. Calls come one at a time from `Dictation`.
final class Transcriber: @unchecked Sendable {
    private var kit: WhisperKit?
    private var loaded: String?

    enum Failure: LocalizedError {
        case notLoaded
        var errorDescription: String? { "The speech model isn't ready yet." }
    }

    func isLoaded(_ variant: String) -> Bool { loaded == variant && kit != nil }

    /// Downloads a model (once) and returns the folder it is in.
    func download(_ variant: String, progress: @escaping @Sendable (Double) -> Void) async throws -> URL {
        try await WhisperKit.download(variant: variant, progressCallback: { progress($0.fractionCompleted) })
    }

    func load(_ variant: String, folder: URL) async throws {
        kit = nil
        loaded = nil
        // The app transcribes while it is in the background, where the graphics chip isn't allowed,
        // so everything runs on the processor and the Neural Engine.
        let compute = ModelComputeOptions(
            melCompute: .cpuOnly,
            audioEncoderCompute: .cpuAndNeuralEngine,
            textDecoderCompute: .cpuAndNeuralEngine)
        let config = WhisperKitConfig(
            model: variant,
            modelFolder: folder.path,
            computeOptions: compute,
            verbose: false,
            logLevel: .error,
            prewarm: true,
            load: true,
            download: false)
        kit = try await WhisperKit(config)
        loaded = variant
    }

    func unload() {
        kit = nil
        loaded = nil
    }

    func transcribe(_ samples: [Float]) async throws -> String {
        guard let kit else { throw Failure.notLoaded }
        let options = DecodingOptions(language: "en", skipSpecialTokens: true, withoutTimestamps: true)
        let results = try await kit.transcribe(audioArray: samples, decodeOptions: options)
        return results.map(\.text).joined(separator: " ")
    }
}

/// Voice dictation: the app keeps the microphone on for a while ("armed"), the LukeOS keyboard says
/// when to start and stop, and Whisper turns what was said into text on the phone.
@MainActor @Observable
final class Dictation {
    static let shared = Dictation()

    enum ModelState: Equatable {
        case idle, downloading(Double), loading, ready, failed(String)
    }

    private(set) var phase: DictationPhase = .off
    private(set) var modelState: ModelState = .idle
    private(set) var micDenied = false
    /// The last thing dictated, and how long Whisper took over it.
    private(set) var lastText = ""
    private(set) var lastTook: Double?
    private(set) var lastError: String?
    /// True after the keyboard opened the app to turn the mic on: the screen says to swipe back.
    var openedByKeyboard = false

    var model: DictationModel = DictationModel(rawValue: SharedConfig.defaults.string(forKey: "dictationModel") ?? "") ?? .balanced {
        didSet {
            guard model != oldValue else { return }
            SharedConfig.defaults.set(model.rawValue, forKey: "dictationModel")
            modelState = .idle
            if phase != .off { Task { await loadModel() } }
        }
    }

    /// How long the mic stays on after it was last used.
    static let staysOn: Duration = .seconds(15 * 60)

    private let mic = MicCapture()
    private let transcriber = Transcriber()
    private var status = DictationStatus()
    private var offTimer: Task<Void, Never>?
    private var loading: Task<Void, Never>?
    private var forKeyboard = false
    private var listening = false

    private init() {}

    /// Starts listening for the keyboard. Called once when the app starts.
    func listen() {
        guard !listening else { return }
        listening = true
        publish()
        DictationHistory.shared.prune()
        DictationLink.listen(for: [.start, .stop, .cancel, .ping])
        let center = NotificationCenter.default
        func on(_ name: Notification.Name, _ action: @escaping @Sendable @MainActor (Dictation) async -> Void) {
            center.addObserver(forName: name, object: nil, queue: .main) { _ in
                Task { @MainActor in await action(Dictation.shared) }
            }
        }
        on(DictationLink.name(.start)) { $0.start(forKeyboard: true) }
        on(DictationLink.name(.stop)) { await $0.stop() }
        on(DictationLink.name(.cancel)) { $0.cancel() }
        on(DictationLink.name(.ping)) { $0.publish() }
        on(AVAudioSession.interruptionNotification) { $0.turnOff() }
        on(.AVAudioEngineConfigurationChange) { $0.micChanged() }
    }

    // MARK: Mic on and off

    /// Turns the microphone on and gets the model ready. The mic stays on in the background.
    func turnOn() async {
        guard phase == .off else { touch(); return }
        guard await AVAudioApplication.requestRecordPermission() else {
            micDenied = true
            return
        }
        micDenied = false
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .defaultToSpeaker, .allowBluetoothA2DP])
            try session.setActive(true)
            try mic.start()
        } catch {
            lastError = "The microphone couldn't start."
            publish()
            return
        }
        lastError = nil
        phase = .ready
        publish()
        touch()
        await loadModel()
    }

    func turnOff() {
        guard phase != .off else { return }
        offTimer?.cancel()
        mic.stop()
        phase = .off
        openedByKeyboard = false
        publish()
        // Hand the sound back to music and podcasts.
        AudioPlayer.shared.configureSession()
    }

    /// The sound setup changed under the mic (music started, headphones). Try to carry on.
    private func micChanged() {
        guard phase != .off, !mic.isRunning else { return }
        do { try mic.start() } catch { turnOff() }
    }

    /// Restarts the countdown to turning the mic off.
    private func touch() {
        offTimer?.cancel()
        offTimer = Task { [weak self] in
            try? await Task.sleep(for: Dictation.staysOn)
            guard !Task.isCancelled else { return }
            self?.turnOff()
        }
    }

    // MARK: Model

    /// Downloads the chosen model if it isn't on the phone yet, then loads it.
    func loadModel() async {
        if let loading { await loading.value }
        let variant = model.variant
        if transcriber.isLoaded(variant) {
            modelState = .ready
            return
        }
        let task = Task { await self.fetchAndLoad(variant) }
        loading = task
        await task.value
        loading = nil
    }

    private func fetchAndLoad(_ variant: String) async {
        do {
            let folder: URL
            if let saved = savedFolder(variant) {
                folder = saved
            } else {
                modelState = .downloading(0)
                folder = try await transcriber.download(variant) { fraction in
                    Task { @MainActor in
                        if case .downloading = Dictation.shared.modelState { Dictation.shared.modelState = .downloading(fraction) }
                    }
                }
                remember(folder, for: variant)
            }
            modelState = .loading
            try await transcriber.load(variant, folder: folder)
            modelState = variant == model.variant ? .ready : .idle
        } catch {
            forget(variant)
            modelState = .failed(error.localizedDescription)
        }
    }

    /// Model folders are remembered by their path inside Documents, which survives app updates.
    private var documents: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }

    private func savedFolder(_ variant: String) -> URL? {
        guard let relative = SharedConfig.defaults.string(forKey: "dictationFolder.\(variant)") else { return nil }
        let url = documents.appendingPathComponent(relative)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    private func remember(_ folder: URL, for variant: String) {
        let base = documents.standardizedFileURL.path
        let path = folder.standardizedFileURL.path
        guard path.hasPrefix(base) else { return }
        SharedConfig.defaults.set(String(path.dropFirst(base.count)), forKey: "dictationFolder.\(variant)")
    }

    private func forget(_ variant: String) {
        SharedConfig.defaults.removeObject(forKey: "dictationFolder.\(variant)")
    }

    // MARK: Recording

    func start(forKeyboard: Bool = false) {
        guard phase == .ready else {
            // The keyboard asked while something else was going on: tell it where things stand.
            if forKeyboard { publish() }
            return
        }
        if !mic.isRunning {
            do { try mic.start() } catch { turnOff(); return }
        }
        self.forKeyboard = forKeyboard
        mic.begin()
        lastError = nil
        phase = .recording
        publish()
        touch()
    }

    func cancel() {
        guard phase == .recording else { return }
        _ = mic.end()
        phase = .ready
        publish()
    }

    /// Stops recording and turns it into text. Text asked for by the keyboard is handed to it.
    func stop() async {
        guard phase == .recording else { return }
        let samples = mic.end()
        phase = .transcribing
        publish()
        touch()

        var text = ""
        var failure: String?
        let began = Date()
        if Self.hasSpeech(samples) {
            await loadModel()
            do {
                text = Self.tidy(try await transcriber.transcribe(samples))
            } catch {
                failure = error.localizedDescription
            }
            // Keep it for a week in case typing it into the app goes wrong. If Whisper failed,
            // keep the recording instead so it can be tried again.
            if !text.isEmpty {
                DictationHistory.shared.add(text: text)
            } else if failure != nil {
                DictationHistory.shared.addFailed(samples: samples)
            }
        }
        lastTook = Date().timeIntervalSince(began)
        lastText = text
        lastError = failure
        if forKeyboard, !text.isEmpty {
            status.resultID = UUID().uuidString
            status.text = text
        }
        forKeyboard = false
        // The mic may have been turned off while Whisper was working.
        if phase == .transcribing { phase = .ready }
        publish()
    }

    /// Tries a kept recording again (Whisper failed the first time).
    func retry(_ entry: DictationEntry) async {
        guard let samples = DictationHistory.shared.samples(for: entry) else { return }
        await loadModel()
        do {
            let text = Self.tidy(try await transcriber.transcribe(samples))
            if text.isEmpty {
                DictationHistory.shared.remove(entry.id)
            } else {
                DictationHistory.shared.resolve(entry.id, text: text)
            }
        } catch {
            Toasts.shared.show(error.localizedDescription)
        }
    }

    /// Too short or too quiet to be speech. Whisper makes words up when it is given silence.
    private static func hasSpeech(_ samples: [Float]) -> Bool {
        guard samples.count > 16_000 * 3 / 10 else { return false }
        var peak: Float = 0
        for s in samples { peak = max(peak, abs(s)) }
        return peak > 0.01
    }

    /// Whisper's own marks for noise, like [BLANK_AUDIO], are dropped. Words are left as said.
    nonisolated static func tidy(_ raw: String) -> String {
        raw.replacingOccurrences(of: #"\[[A-Za-z_ ]+\]|\((silence|music|blank audio)\)"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Saves where things stand and tells the keyboard.
    private func publish() {
        status.phase = phase
        status.updatedAt = Date()
        status.error = lastError
        DictationLink.write(status)
        DictationLink.post(.status)
    }
}
