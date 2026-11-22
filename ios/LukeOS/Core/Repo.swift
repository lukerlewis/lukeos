import Foundation
import Network
import Observation

/// A local copy of every answer the app has read, so screens open instantly and work offline.
actor ResponseCache {
    static let shared = ResponseCache()

    private let dir: URL = {
        let d = SharedConfig.containerURL.appending(path: "Cache", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    private func file(_ key: String) -> URL {
        let safe = key.replacingOccurrences(of: "[^A-Za-z0-9._-]", with: "_", options: .regularExpression)
        return dir.appending(path: String(safe.prefix(180)) + ".json")
    }

    func read(_ key: String) -> Data? { try? Data(contentsOf: file(key)) }
    func write(_ key: String, _ data: Data) { try? data.write(to: file(key), options: .atomic) }
    func clear() { try? FileManager.default.removeItem(at: dir); try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }
}

/// Changes made while offline, sent in order once the phone is back online.
/// If the server has moved on in the meantime, the last write wins, as on the web.
@MainActor @Observable
final class Outbox {
    static let shared = Outbox()

    struct Item: Codable, Identifiable {
        var id = UUID()
        var name: String
        var input: Input
    }

    private(set) var items: [Item] = []
    private(set) var isOnline = true
    private var flushing = false
    private let monitor = NWPathMonitor()
    private let file = SharedConfig.containerURL.appending(path: "outbox.json")

    private init() {
        if let data = try? Data(contentsOf: file), let saved = try? JSONDecoder().decode([Item].self, from: data) {
            items = saved
        }
        monitor.pathUpdateHandler = { path in
            Task { @MainActor in
                let online = path.status == .satisfied
                let cameBack = online && !Outbox.shared.isOnline
                Outbox.shared.isOnline = online
                if cameBack { await Outbox.shared.flush() }
            }
        }
        monitor.start(queue: .global(qos: .utility))
    }

    /// Queues a change. A newer change to the same thing replaces one still waiting (a podcast's place,
    /// a note's text), so hours offline don't pile up hundreds of saves.
    func add(_ name: String, _ input: Input) {
        let coalesce: Set<String> = ["update_episode", "update_note", "update_scratch_pad", "update_document", "log_focus_session"]
        if coalesce.contains(name), let last = items.indices.last(where: { items[$0].name == name && items[$0].input["id"] == input["id"] }),
           Set(items[last].input.keys).isSubset(of: Set(input.keys)) {
            items[last].input = input
        } else {
            items.append(Item(name: name, input: input))
        }
        save()
    }

    private func save() {
        try? JSONEncoder().encode(items).write(to: file, options: .atomic)
    }

    /// Sends everything waiting. Stops at the first item that can't go yet (still offline).
    func flush() async {
        guard !flushing, !items.isEmpty else { return }
        flushing = true
        defer { flushing = false }
        while let item = items.first {
            do {
                _ = try await LukeAPI.shared.opData(item.name, item.input)
                items.removeFirst()
            } catch APIError.offline {
                break
            } catch {
                // The server turned it down (the thing was deleted, say); drop it rather than retry forever.
                items.removeFirst()
            }
            save()
        }
        if items.isEmpty { NotificationCenter.default.post(name: .lukeOSSynced, object: nil) }
    }
}

extension Notification.Name {
    static let lukeOSSynced = Notification.Name("lukeOSSynced")
    static let lukeOSSignedOut = Notification.Name("lukeOSSignedOut")
}

/// How screens read and change things.
enum Repo {
    static var api: LukeAPI { .shared }

    static func key(_ name: String, _ input: Input) -> String {
        let enc = JSONEncoder()
        enc.outputFormatting = .sortedKeys
        let body = (try? enc.encode(JSON.object(input))).map { String(decoding: $0, as: UTF8.self) } ?? ""
        return input.isEmpty ? name : "\(name)-\(body)"
    }

    /// The copy saved from last time, if there is one.
    static func cached<T: Decodable>(_ name: String, _ input: Input = [:], as: T.Type = T.self) async -> T? {
        guard let data = await ResponseCache.shared.read(key(name, input)) else { return nil }
        return try? LukeAPI.decoder.decode(T.self, from: data)
    }

    /// A fresh answer from the server, saved for next time.
    static func fetch<T: Decodable>(_ name: String, _ input: Input = [:], as: T.Type = T.self) async throws -> T {
        do {
            let data = try await api.opData(name, input)
            let value = try LukeAPI.decoder.decode(T.self, from: data)
            await ResponseCache.shared.write(key(name, input), data)
            return value
        } catch APIError.signedOut {
            await MainActor.run { NotificationCenter.default.post(name: .lukeOSSignedOut, object: nil) }
            throw APIError.signedOut
        }
    }

    /// Makes a change. Offline, it's queued and sent later (returns nil). Server errors show as a toast.
    @discardableResult
    static func change(_ name: String, _ input: Input) async -> Data? {
        let mustWait = await MainActor.run { !Outbox.shared.items.isEmpty || !Outbox.shared.isOnline }
        if mustWait {
            await Outbox.shared.add(name, input)
            return nil
        }
        do {
            return try await api.opData(name, input)
        } catch APIError.offline {
            await Outbox.shared.add(name, input)
            return nil
        } catch APIError.signedOut {
            await MainActor.run { NotificationCenter.default.post(name: .lukeOSSignedOut, object: nil) }
            return nil
        } catch {
            await Toasts.shared.show(error.localizedDescription)
            return nil
        }
    }

    /// A change whose answer the screen needs (a new id). Not queued offline.
    static func create<T: Decodable>(_ name: String, _ input: Input, as: T.Type = T.self) async throws -> T {
        do {
            return try await api.op(name, input, as: T.self)
        } catch APIError.signedOut {
            await MainActor.run { NotificationCenter.default.post(name: .lukeOSSignedOut, object: nil) }
            throw APIError.signedOut
        }
    }
}

/// Short messages at the bottom of the screen, with an optional Undo.
@MainActor @Observable
final class Toasts {
    static let shared = Toasts()

    struct Toast: Identifiable, Equatable {
        let id = UUID()
        var text: String
        var undo: (@MainActor () -> Void)?
        static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
    }

    var current: Toast?

    func show(_ text: String, undo: (@MainActor () -> Void)? = nil) {
        let toast = Toast(text: text, undo: undo)
        current = toast
        Task {
            try? await Task.sleep(for: .seconds(undo == nil ? 2.5 : 4.5))
            if current == toast { current = nil }
        }
    }
}
