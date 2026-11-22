import DeviceActivity
import Foundation

/// Runs without the app. iOS wakes it at the start of each day (yesterday's focus time stops
/// counting, so the apps lock again), when a cooldown's wait is over (unlock) and when a cooldown's
/// open time ends (lock again). Each time it reads what is saved and blocks or unlocks to match.
class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        ScreenBlock.settleFromSaved()
    }

    override func intervalWillEndWarning(for activity: DeviceActivityName) {
        super.intervalWillEndWarning(for: activity)
        ScreenBlock.settleFromSaved()
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        ScreenBlock.settleFromSaved()
    }
}
