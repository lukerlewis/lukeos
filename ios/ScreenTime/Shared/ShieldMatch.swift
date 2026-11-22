import Foundation
import ManagedSettings

/// What a blocked app, category or website was blocked by. Used by the block screen and its buttons.
enum ShieldTarget {
    case app(ApplicationToken?)
    case category(ActivityCategoryToken?)
    case site(WebDomainToken?)

    /// The protocols blocking this right now.
    func blockers(_ protocols: [BlockProtocol], _ progress: BlockProgress, today: String) -> [BlockProtocol] {
        protocols.filter { p in
            guard p.state(progress, today: today).blocks else { return false }
            switch self {
            case .app(let token): return token.map { p.apps.applicationTokens.contains($0) } ?? false
            case .category(let token): return token.map { p.apps.categoryTokens.contains($0) } ?? false
            case .site(let token): return token.map { p.apps.webDomainTokens.contains($0) } ?? false
            }
        }
    }
}
