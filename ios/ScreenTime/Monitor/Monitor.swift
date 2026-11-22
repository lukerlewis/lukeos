import DeviceActivity
import Foundation

/// Runs without the app: at the start of each day iOS wakes this up and the apps are locked again,
/// because yesterday's focus time no longer counts.
class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        guard activity == ScreenBlock.daily else { return }
        let today = ScreenBlock.localDay()
        var progress = ScreenBlock.loadProgress()
        if progress.day != today {
            progress.day = today
            progress.focusSeconds = 0
            ScreenBlock.save(progress)
        }
        ScreenBlock.apply(ScreenBlock.loadRule(), progress, today: today)
    }
}
