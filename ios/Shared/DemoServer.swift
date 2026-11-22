import Foundation

/// Demo mode: answers from the real responses bundled in `Fixtures/` (see `Fixtures/index.json`),
/// so every screen can be opened without signing in. Changes are accepted and answered with what was sent.
actor DemoServer {
    static let shared = DemoServer()

    private struct Entry: Decodable { var file: String; var op: String; var input: [String: JSON] }
    private struct FileEntry: Decodable { var file: String; var contentType: String }

    private var index: [Entry] = []
    private var files: [String: FileEntry] = [:]
    private var cache: [String: Data] = [:]
    private var loaded = false

    static var folder: URL? { Bundle.main.url(forResource: "Fixtures", withExtension: nil) }

    private func load() {
        guard !loaded else { return }
        loaded = true
        guard let folder = Self.folder else { return }
        if let data = try? Data(contentsOf: folder.appending(path: "index.json")) {
            index = (try? JSONDecoder().decode([Entry].self, from: data)) ?? []
        }
        if let data = try? Data(contentsOf: folder.appending(path: "files.json")) {
            files = (try? JSONDecoder().decode([String: FileEntry].self, from: data)) ?? [:]
        }
    }

    private func read(_ file: String) -> Data? {
        if let hit = cache[file] { return hit }
        guard let url = Self.folder?.appending(path: file), let data = try? Data(contentsOf: url) else { return nil }
        cache[file] = data
        return data
    }

    func run(_ name: String, _ input: Input) async throws -> Data {
        load()
        try? await Task.sleep(for: .milliseconds(150))
        let same = index.filter { $0.op == name }
        // Exact input first, then one whose input is all in the request, then the plain one.
        let pick = same.first { $0.input == input }
            ?? same.first { !$0.input.isEmpty && $0.input.allSatisfy { input[$0.key] == $0.value } }
            ?? same.first { $0.input.isEmpty }
            ?? same.first
        if let pick, let data = read(pick.file) {
            if let id = input["id"]?.stringValue, pick.input["id"] != nil, pick.input["id"]?.stringValue != id,
               name.hasPrefix("get_") {
                // A different item than the one captured: show the captured one with this id.
                if var obj = try? JSONDecoder().decode([String: JSON].self, from: data) {
                    obj["id"] = .string(id)
                    return try JSONEncoder().encode(obj)
                }
            }
            return data
        }
        if name.hasPrefix("get_") || name.hasPrefix("list_") || name == "search" {
            throw APIError.server("Nothing here in the demo.", 404)
        }
        var echo = input
        if echo["id"] == nil { echo["id"] = .string(UUID().uuidString.lowercased()) }
        echo["createdAt"] = .string(ISO8601DateFormatter.withFractional.string(from: .now))
        echo["updatedAt"] = echo["createdAt"]
        return try JSONEncoder().encode(JSON.object(echo))
    }

    /// App-only reads (`api/app/home`, `api/app/messages`).
    func get(_ path: String) async throws -> Data {
        load()
        let file = path.contains("app/home") ? "app_home.json" : path.contains("app/messages") ? "app_messages.json" : ""
        guard let data = read(file) else { throw APIError.server("Nothing here in the demo.", 404) }
        return data
    }

    func upload(_ path: String) async throws -> Data {
        try JSONEncoder().encode(JSON.object(["id": .string(UUID().uuidString.lowercased()), "fileId": .string(UUID().uuidString.lowercased())]))
    }

    /// The bundled copy of a file the fixtures point at.
    func localFile(_ path: String) -> URL? {
        load()
        let key = path.components(separatedBy: "?").first?.components(separatedBy: "#").first ?? path
        guard let entry = files[key] else {
            // Podcast episodes point at example.com: play a bundled song instead.
            if key.hasSuffix(".mp3") || key.contains("example.com") {
                return files.values.first { $0.contentType.hasPrefix("audio") }.flatMap { Self.folder?.appending(path: $0.file) }
            }
            return nil
        }
        return Self.folder?.appending(path: entry.file)
    }
}

extension ISO8601DateFormatter {
    nonisolated(unsafe) static let withFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    nonisolated(unsafe) static let plain: ISO8601DateFormatter = ISO8601DateFormatter()
}
