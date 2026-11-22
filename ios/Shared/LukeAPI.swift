import Foundation

enum APIError: LocalizedError, Equatable {
    case signedOut
    case offline
    case server(String, Int)

    var errorDescription: String? {
        switch self {
        case .signedOut: "Signed out."
        case .offline: "You're offline."
        case .server(let message, _): message
        }
    }
}

/// Talks to the LukeOS server. Every action is POST /api/ops/<name> with a JSON body.
final class LukeAPI: Sendable {
    static let shared = LukeAPI()

    let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = false
        config.httpCookieStorage = .shared
        session = URLSession(configuration: config)
    }

    var baseURL: URL { SharedConfig.baseURL }

    static let decoder = JSONDecoder()

    // MARK: Operations

    /// Runs an operation and returns the raw JSON answer.
    func opData(_ name: String, _ input: Input = [:]) async throws -> Data {
        WriteRecorder.record(name, input)
        if SharedConfig.isDemo { return try await DemoServer.shared.run(name, input) }
        var req = request("api/ops/\(name)")
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONEncoder().encode(JSON.object(input))
        return try await send(req)
    }

    func op<T: Decodable>(_ name: String, _ input: Input = [:], as type: T.Type = T.self) async throws -> T {
        let data = try await opData(name, input)
        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            #if DEBUG
            print("Decoding \(name) as \(T.self) failed: \(error)")
            #endif
            throw error
        }
    }

    /// An app-only read: `api/app/home`, `api/app/messages?limit=200`.
    func getData(_ path: String, query: [URLQueryItem] = []) async throws -> Data {
        if SharedConfig.isDemo { return try await DemoServer.shared.get(path) }
        return try await send(request(path, query: query))
    }

    // MARK: Plain requests

    func request(_ path: String, query: [URLQueryItem] = []) -> URLRequest {
        var comps = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query }
        var req = URLRequest(url: comps.url!)
        if let token = TokenStore.token { req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        req.setValue("ios", forHTTPHeaderField: "x-lukeos-client")
        return req
    }

    func send(_ req: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch let error as URLError where [.notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost, .timedOut, .dataNotAllowed, .internationalRoamingOff].contains(error.code) {
            throw APIError.offline
        }
        guard let http = response as? HTTPURLResponse else { return data }
        if http.statusCode == 401 { throw APIError.signedOut }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode([String: JSON].self, from: data))?["error"]?.stringValue
            throw APIError.server(message ?? "Something went wrong. Try again.", http.statusCode)
        }
        return data
    }

    /// Uploads a file's bytes to an upload route and returns the JSON answer.
    func upload(_ path: String, data body: Data, contentType: String, query: [URLQueryItem] = []) async throws -> Data {
        if SharedConfig.isDemo { return try await DemoServer.shared.upload(path) }
        var req = request(path, query: query)
        req.httpMethod = "POST"
        req.setValue(contentType, forHTTPHeaderField: "content-type")
        req.httpBody = body
        req.timeoutInterval = 120
        return try await send(req)
    }

    /// A file served by LukeOS (`/api/stored/<id>`, `/api/images/<id>`), with the token added.
    func fileURL(_ path: String) -> URL {
        if path.hasPrefix("http") { return URL(string: path)! }
        return baseURL.appending(path: path.hasPrefix("/") ? String(path.dropFirst()) : path)
    }

    // MARK: Signing in

    /// Swaps a code from Settings > Devices for a token.
    func signIn(code: String) async throws {
        var req = request("api/auth/invite/use")
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        // Take the code off the end of a pasted link (…/sign-in/add/ABCDE-23456).
        let raw = code.trimmingCharacters(in: .whitespacesAndNewlines)
        let typed = raw.contains("/") ? String(raw.split(separator: "/").last ?? "") : raw
        req.httpBody = try JSONEncoder().encode(["code": typed.uppercased()])
        let data: Data
        do {
            data = try await send(req)
        } catch APIError.server(let message, _) {
            throw APIError.server(message, 403)
        }
        struct Answer: Decodable { let token: String? }
        guard let token = try Self.decoder.decode(Answer.self, from: data).token else {
            throw APIError.server("That code didn't work.", 403)
        }
        TokenStore.save(token)
        installCookie()
    }

    func signOut() async {
        var req = request("api/auth/logout")
        req.httpMethod = "POST"
        _ = try? await session.data(for: req)
        TokenStore.clear()
        if let cookies = HTTPCookieStorage.shared.cookies(for: baseURL) {
            for c in cookies { HTTPCookieStorage.shared.deleteCookie(c) }
        }
    }

    /// The token as the site's session cookie, so images, audio and web views are signed in too.
    var sessionCookie: HTTPCookie? {
        guard let token = TokenStore.token, let host = baseURL.host() else { return nil }
        return HTTPCookie(properties: [
            .name: "lukeos_session",
            .value: token,
            .domain: host,
            .path: "/",
            .secure: baseURL.scheme == "https" ? "TRUE" : "FALSE",
            .expires: Date().addingTimeInterval(180 * 24 * 3600),
        ])
    }

    func installCookie() {
        if let c = sessionCookie { HTTPCookieStorage.shared.setCookie(c) }
    }
}

/// Debug check: launched with `-recordWrites`, every change the app sends is appended to
/// `Documents/recorded-writes.jsonl` as {"op": ..., "input": ...}, so it can be replayed against the server's rules.
enum WriteRecorder {
    static let on = ProcessInfo.processInfo.arguments.contains("-recordWrites")
    private static let lock = NSLock()

    static func record(_ name: String, _ input: Input) {
        guard on, !(name.hasPrefix("get_") || name.hasPrefix("list_") || name == "search") else { return }
        let enc = JSONEncoder()
        enc.outputFormatting = .sortedKeys
        guard let data = try? enc.encode(JSON.object(["op": .string(name), "input": .object(input)])) else { return }
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appending(path: "recorded-writes.jsonl")
        lock.lock()
        defer { lock.unlock() }
        if !FileManager.default.fileExists(atPath: url.path()) { FileManager.default.createFile(atPath: url.path(), contents: nil) }
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile()
            h.write(data + Data("\n".utf8))
            try? h.close()
        }
    }
}
