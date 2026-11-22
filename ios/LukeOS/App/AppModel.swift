import SwiftUI
import Observation

enum AppTab: String, Hashable, CaseIterable {
    case dashboard, notes, focus, music, more
}

/// App-wide state: signed in or not, the open tab, Work or Life, and where a notification should go.
@MainActor @Observable
final class AppModel {
    static let shared = AppModel()

    var signedIn: Bool = SharedConfig.isDemo || TokenStore.token != nil
    var tab: AppTab = .dashboard
    /// Work or Life is chosen on each device; the phone starts on Life.
    var area: Area = Area(rawValue: SharedConfig.defaults.string(forKey: "area") ?? "") ?? .life {
        didSet { SharedConfig.defaults.set(area.rawValue, forKey: "area") }
    }
    /// A path from a notification or link (`/notes/<id>`, `/messages`, `/?task=<id>`), waiting to be opened.
    var pendingLink: String?
    /// Luke's "today" from the server (his time zone).
    var today: String = Day.today()

    private init() {
        NotificationCenter.default.addObserver(forName: .lukeOSSignedOut, object: nil, queue: .main) { _ in
            Task { @MainActor in AppModel.shared.handleSignedOut() }
        }
        if signedIn { LukeAPI.shared.installCookie() }
    }

    func handleSignedOut() {
        guard !SharedConfig.isDemo, signedIn else { return }
        TokenStore.clear()
        signedIn = false
    }

    func signOut() async {
        await LukeAPI.shared.signOut()
        await ResponseCache.shared.clear()
        signedIn = false
    }

    /// Opens a LukeOS path in the right tab.
    func open(_ path: String) {
        pendingLink = path
        if path.hasPrefix("/notes") { tab = .notes }
        else if path.hasPrefix("/focus") { tab = .focus }
        else if path.hasPrefix("/listen") { tab = .music }
        else if path == "/" || path.hasPrefix("/?") { tab = .dashboard }
        else { tab = .more }
    }

    func handle(url: URL) {
        // lukeos://open?path=/notes/<id>, or a lukeos-kappa link.
        if url.scheme == "lukeos" {
            if let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "path" })?.value {
                open(path)
            } else if url.host() == "add-task" {
                tab = .dashboard
                pendingLink = "/?new=task"
            }
        } else {
            var path = url.path()
            if let q = url.query() { path += "?\(q)" }
            open(path.isEmpty ? "/" : path)
        }
    }

    /// Takes the pending link if it starts with the prefix.
    func take(_ prefix: String) -> String? {
        guard let link = pendingLink, link.hasPrefix(prefix) else { return nil }
        pendingLink = nil
        return link
    }
}
