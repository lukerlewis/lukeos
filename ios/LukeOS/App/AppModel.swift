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
        applyLaunchArguments()
    }

    /// `-area work`, `-layout board`, `-link /notes/<id>`: open the app in a given state (demo screenshots, UI checks).
    private func applyLaunchArguments() {
        let args = ProcessInfo.processInfo.arguments
        func value(_ key: String) -> String? {
            guard let i = args.firstIndex(of: key), i + 1 < args.count else { return nil }
            return args[i + 1]
        }
        if let a = value("-area").flatMap(Area.init(rawValue:)) { area = a }
        if let l = value("-layout") { SharedConfig.defaults.set(l, forKey: "dashboardLayout") }
        if let link = value("-link") { open(link) }
        if let t = value("-tab").flatMap(AppTab.init(rawValue:)) { tab = t }
        if let m = value("-focusMode").flatMap(FocusMode.init(rawValue:)) { FocusTimer.shared.state.mode = m }
        if let m = value("-musicTab") { SharedConfig.defaults.set(m, forKey: "musicTab") }
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
            } else if url.host() == "dictate" {
                // The LukeOS keyboard opens this to turn the mic on.
                open("/dictation")
                Dictation.shared.openedByKeyboard = true
                Task { await Dictation.shared.turnOn() }
            } else if let host = url.host() {
                // lukeos://task/<id>, lukeos://note/<id>, lukeos://document/<id>, lukeos://messages
                let id = url.pathComponents.dropFirst().first ?? ""
                switch host {
                case "task": open("/?task=\(id)")
                case "note": open("/notes/\(id)")
                case "document": open("/documents/\(id)")
                case "project": open("/projects/\(id)")
                default: open("/\(host)")
                }
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
