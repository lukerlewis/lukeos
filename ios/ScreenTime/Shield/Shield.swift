import ManagedSettings
import ManagedSettingsUI
import UIKit

/// The screen iOS shows over a blocked app: LukeOS greys, which protocol blocked it and what is
/// left to do. A cooldown protocol gets a second button that starts the wait.
class ShieldConfigurationExtension: ShieldConfigurationDataSource {
    override func configuration(shielding application: Application) -> ShieldConfiguration { make(.app(application.token)) }
    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
        make(.category(category.token), or: .app(application.token))
    }
    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration { make(.site(webDomain.token)) }
    override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration {
        make(.category(category.token), or: .site(webDomain.token))
    }

    private func make(_ target: ShieldTarget, or other: ShieldTarget? = nil) -> ShieldConfiguration {
        let today = ScreenBlock.localDay()
        let progress = ScreenBlock.loadProgress()
        let all = ScreenBlock.loadProtocols()
        var blockers = target.blockers(all, progress, today: today)
        if let other { blockers += other.blockers(all, progress, today: today).filter { b in !blockers.contains { $0.id == b.id } } }

        var lines: [String] = []
        var button: String?
        if let first = blockers.first {
            if !first.name.isEmpty { lines.append(first.name) }
            lines.append(ScreenBlock.summary(first, progress, today: today))
            // The wait can only be started here when every protocol blocking this app allows it.
            let waiting = blockers.filter { $0.strictness == .cooldown && $0.unlockAt == nil }
            if waiting.count == blockers.count, let longest = waiting.map(\.cooldownMinutes).max() {
                button = "Unlock in \(longest) min"
            }
        } else {
            lines.append("Open LukeOS to unlock")
        }
        return ShieldConfiguration(
            backgroundBlurStyle: .systemMaterial,
            backgroundColor: .systemBackground,
            icon: UIImage(systemName: "lock"),
            title: .init(text: "Blocked by LukeOS", color: .label),
            subtitle: .init(text: lines.joined(separator: "\n"), color: .secondaryLabel),
            primaryButtonLabel: .init(text: "OK", color: .systemBackground),
            primaryButtonBackgroundColor: .label,
            secondaryButtonLabel: button.map { ShieldConfiguration.Label(text: $0, color: .label) }
        )
    }
}
