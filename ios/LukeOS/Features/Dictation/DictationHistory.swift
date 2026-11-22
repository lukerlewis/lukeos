import Foundation
import Observation

/// One thing Luke dictated. If Whisper failed, `text` is empty and the recording is kept so it can be tried again.
struct DictationEntry: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var date: Date
    var text: String
    /// File name of the kept recording (only when Whisper failed).
    var audio: String?

    var failed: Bool { text.isEmpty }
}

/// Everything dictated in the last week, kept on the phone in case typing it into an app went wrong.
/// Older entries are deleted on their own.
@MainActor @Observable
final class DictationHistory {
    static let shared = DictationHistory()

    /// How long a transcript is kept.
    nonisolated static let keepsFor: TimeInterval = 7 * 24 * 60 * 60

    /// Newest first.
    private(set) var entries: [DictationEntry] = []

    private let folder: URL
    private var file: URL { folder.appendingPathComponent("history.json") }

    private init() {
        folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Dictation", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: file),
           let saved = try? JSONDecoder().decode([DictationEntry].self, from: data) {
            entries = saved
        }
        prune()
        share()
    }

    /// Hands the newest transcript to the keyboard's copy button.
    private func share() {
        DictationLink.writeLast(entries.first { !$0.failed }?.text)
    }

    /// The entries still inside the week.
    nonisolated static func kept(_ entries: [DictationEntry], now: Date) -> [DictationEntry] {
        entries.filter { now.timeIntervalSince($0.date) < keepsFor }
    }

    /// Deletes anything older than a week, and recordings nothing points to any more.
    func prune(now: Date = Date()) {
        let fresh = Self.kept(entries, now: now)
        if fresh != entries {
            entries = fresh
            save()
        }
        let wanted = Set(entries.compactMap(\.audio))
        let files = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        for name in files where name.hasSuffix(".pcm") && !wanted.contains(name) {
            try? FileManager.default.removeItem(at: folder.appendingPathComponent(name))
        }
    }

    func add(text: String) {
        entries.insert(DictationEntry(id: UUID().uuidString, date: Date(), text: text, audio: nil), at: 0)
        prune()
        save()
    }

    /// Whisper failed: keep the recording so it can be tried again.
    func addFailed(samples: [Float]) {
        let id = UUID().uuidString
        let name = "\(id).pcm"
        let data = samples.withUnsafeBufferPointer { Data(buffer: $0) }
        guard (try? data.write(to: folder.appendingPathComponent(name), options: .atomic)) != nil else { return }
        entries.insert(DictationEntry(id: id, date: Date(), text: "", audio: name), at: 0)
        prune()
        save()
    }

    /// The kept recording of a failed entry.
    func samples(for entry: DictationEntry) -> [Float]? {
        guard let name = entry.audio, let data = try? Data(contentsOf: folder.appendingPathComponent(name)) else { return nil }
        return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    }

    /// A failed entry was written after all: keep the words, drop the recording.
    func resolve(_ id: String, text: String) {
        guard let i = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[i].text = text
        entries[i].audio = nil
        save()
        prune()
    }

    func remove(_ id: String) {
        entries.removeAll { $0.id == id }
        save()
        prune()
    }

    func clear() {
        entries = []
        save()
        prune()
    }

    private func save() {
        share()
        guard let data = try? JSONEncoder().encode(entries) else { return }
        try? data.write(to: file, options: .atomic)
    }
}
