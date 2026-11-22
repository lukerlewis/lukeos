import Foundation

/// Where dictation is: mic off, mic on and waiting, recording, or turning speech into text.
enum DictationPhase: String, Codable, Sendable {
    case off, ready, recording, transcribing
}

/// What the app tells the keyboard. Saved as a small file in the shared container.
struct DictationStatus: Codable, Equatable, Sendable {
    var phase: DictationPhase = .off
    var updatedAt: Date = .distantPast
    /// The last finished dictation. The keyboard types each `resultID` once.
    var resultID: String?
    var text: String?
    var error: String?
}

/// How the keyboard and the app talk. A keyboard can't use the microphone, so the app records and
/// transcribes; the keyboard sends signals (start, stop) and the app answers with `status`.
enum DictationLink {
    enum Signal: String, CaseIterable, Sendable {
        /// Keyboard to app.
        case start, stop, cancel, ping
        /// App to keyboard: the status file changed.
        case status
    }

    /// The link that opens the app and turns the mic on.
    static let armURL = URL(string: "lukeos://dictate")!

    static func name(_ signal: Signal) -> Notification.Name {
        Notification.Name("com.lewisdesign.lukeos.dictation.\(signal.rawValue)")
    }

    private static var fileURL: URL { SharedConfig.containerURL.appendingPathComponent("dictation-status.json") }

    static func read() -> DictationStatus {
        guard let data = try? Data(contentsOf: fileURL),
              let status = try? JSONDecoder().decode(DictationStatus.self, from: data) else { return DictationStatus() }
        return status
    }

    static func write(_ status: DictationStatus) {
        guard let data = try? JSONEncoder().encode(status) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    // MARK: Last transcript

    /// The newest transcript in the app's History, shared so the keyboard's copy button can reach it.
    private static var lastURL: URL { SharedConfig.containerURL.appendingPathComponent("dictation-last.txt") }

    static func readLast() -> String? {
        guard let text = try? String(contentsOf: lastURL, encoding: .utf8), !text.isEmpty else { return nil }
        return text
    }

    /// `nil` when History is empty.
    static func writeLast(_ text: String?) {
        if let text, !text.isEmpty {
            try? Data(text.utf8).write(to: lastURL, options: .atomic)
        } else {
            try? FileManager.default.removeItem(at: lastURL)
        }
    }

    /// Sends a signal to the other side (it arrives only if that process is running).
    static func post(_ signal: Signal) {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(name(signal).rawValue as CFString), nil, nil, true)
    }

    /// Starts listening for the given signals. Each one is passed on through `NotificationCenter.default`
    /// under `name(signal)`, on the main thread. Call once, from the main thread.
    static func listen(for signals: [Signal]) {
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        for signal in signals {
            CFNotificationCenterAddObserver(center, nil, { _, _, name, _, _ in
                guard let raw = name?.rawValue as String? else { return }
                DispatchQueue.main.async {
                    NotificationCenter.default.post(name: Notification.Name(raw), object: nil)
                }
            }, name(signal).rawValue as CFString, nil, .deliverImmediately)
        }
    }
}
