import ManagedSettings
import ManagedSettingsUI
import UIKit

/// The screen iOS shows over a blocked app: LukeOS greys, and what is left to do.
class ShieldConfigurationExtension: ShieldConfigurationDataSource {
    override func configuration(shielding application: Application) -> ShieldConfiguration { make() }
    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration { make() }
    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration { make() }
    override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration { make() }

    private func make() -> ShieldConfiguration {
        let left = ScreenBlock.remaining(ScreenBlock.loadRule(), ScreenBlock.loadProgress(), today: ScreenBlock.localDay())
        return ShieldConfiguration(
            backgroundBlurStyle: .systemMaterial,
            backgroundColor: .systemBackground,
            icon: UIImage(systemName: "lock"),
            title: .init(text: "Blocked by LukeOS", color: .label),
            subtitle: .init(text: left.isEmpty ? "Open LukeOS to unlock." : left.prefix(1).uppercased() + left.dropFirst() + ".", color: .secondaryLabel),
            primaryButtonLabel: .init(text: "OK", color: .systemBackground),
            primaryButtonBackgroundColor: .label
        )
    }
}
