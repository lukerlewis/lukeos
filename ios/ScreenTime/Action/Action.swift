import ManagedSettings

/// The buttons on the block screen. OK closes the app; "Unlock in 10 min" starts the cooldown on
/// every protocol blocking it and redraws the screen with the time it unlocks.
class ShieldActionExtension: ShieldActionDelegate {
    override func handle(action: ShieldAction, for application: ApplicationToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        respond(action, .app(application), completionHandler)
    }

    override func handle(action: ShieldAction, for webDomain: WebDomainToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        respond(action, .site(webDomain), completionHandler)
    }

    override func handle(action: ShieldAction, for category: ActivityCategoryToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        respond(action, .category(category), completionHandler)
    }

    private func respond(_ action: ShieldAction, _ target: ShieldTarget, _ done: (ShieldActionResponse) -> Void) {
        guard action == .secondaryButtonPressed else { done(.close); return }
        let blockers = target.blockers(ScreenBlock.loadProtocols(), ScreenBlock.loadProgress(), today: ScreenBlock.localDay())
        let waiting = blockers.filter { $0.strictness == .cooldown && $0.unlockAt == nil }
        guard !blockers.isEmpty, waiting.count == blockers.count else { done(.close); return }
        for p in waiting { ScreenBlock.startCooldown(p.id) }
        done(.defer)
    }
}
