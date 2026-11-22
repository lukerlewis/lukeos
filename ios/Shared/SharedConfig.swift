import Foundation
import Security

/// Settings shared by the app and its extensions.
enum SharedConfig {
    static let appGroup = "group.com.lewisdesign.lukeos"

    /// The LukeOS server. Set per build with LUKEOS_BASE_URL; `-baseURL <url>` overrides it at launch.
    static var baseURL: URL {
        if let i = ProcessInfo.processInfo.arguments.firstIndex(of: "-baseURL"),
           i + 1 < ProcessInfo.processInfo.arguments.count,
           let url = URL(string: ProcessInfo.processInfo.arguments[i + 1]) {
            return url
        }
        let raw = Bundle.main.object(forInfoDictionaryKey: "LukeOSBaseURL") as? String ?? ""
        return URL(string: raw.isEmpty || raw.contains("$(") ? "https://lukeos-kappa.vercel.app" : raw)!
    }

    /// Demo mode serves bundled sample data instead of the network (launch with `-demo`).
    static var isDemo: Bool {
        ProcessInfo.processInfo.arguments.contains("-demo")
            || UserDefaults(suiteName: appGroup)?.bool(forKey: "demo") == true
    }

    static var defaults: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }

    static var containerURL: URL {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    }
}

/// The sign-in token, kept in the Keychain and shared with the widgets and the share extension.
enum TokenStore {
    private static let service = "com.lewisdesign.lukeos"
    private static let account = "session"

    private static var accessGroup: String? {
        guard let prefix = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String,
              !prefix.isEmpty, !prefix.contains("$(") else { return nil }
        return "\(prefix)com.lewisdesign.lukeos.shared"
    }

    private static func query() -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let accessGroup { q[kSecAttrAccessGroup as String] = accessGroup }
        return q
    }

    static var token: String? {
        var q = query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ token: String) {
        SecItemDelete(query() as CFDictionary)
        var q = query()
        q[kSecValueData as String] = Data(token.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }

    static func clear() {
        SecItemDelete(query() as CFDictionary)
    }
}
