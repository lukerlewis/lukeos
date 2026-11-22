import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings

/// Luke's rule: the apps he picked stay blocked until he has done what the rule asks.
/// With nothing asked (no focus time, no tasks) the apps are blocked for as long as the rule is on.
struct BlockRule: Codable, Equatable {
    var on = false
    /// The apps, categories and websites Luke picked. Apple only hands out opaque tokens, never names.
    var apps = FamilyActivitySelection()
    /// Minutes of focus needed each day. 0 means focus time isn't asked for.
    var focusMinutes = 0
    /// LukeOS tasks that must be done.
    var taskIds: [String] = []

    var asksForSomething: Bool { focusMinutes > 0 || !taskIds.isEmpty }
    var hasApps: Bool { !apps.applicationTokens.isEmpty || !apps.categoryTokens.isEmpty || !apps.webDomainTokens.isEmpty }
}

/// What the app last knew about Luke's day, saved so the extensions can read it without the network.
struct BlockProgress: Codable, Equatable {
    /// The day (YYYY-MM-DD) the focus time belongs to.
    var day = ""
    var focusSeconds: Double = 0
    /// Picked tasks that are not done yet.
    var openTaskIds: [String] = []

    func focusLeft(_ rule: BlockRule, today: String) -> Int {
        guard rule.focusMinutes > 0 else { return 0 }
        let done = day == today ? Int(focusSeconds / 60) : 0
        return max(0, rule.focusMinutes - done)
    }

    func tasksLeft(_ rule: BlockRule) -> Int { openTaskIds.filter(rule.taskIds.contains).count }
}

/// The one place that decides whether the apps are blocked, and tells iOS.
/// Used by the app, by the extension that locks the apps again each morning, and by the block screen.
///
/// To add a new kind of rule later (a time of day, a list, a project): add a field to `BlockRule`,
/// what the app knows about it to `BlockProgress`, and one line to `shouldBlock`.
enum ScreenBlock {
    static var store: ManagedSettingsStore.Name { .init("lukeos.block") }
    /// The repeating day that locks the apps again at midnight.
    static var daily: DeviceActivityName { .init("lukeos.daily") }

    private static let ruleKey = "screenTime.rule"
    private static let progressKey = "screenTime.progress"
    private static var defaults: UserDefaults { SharedConfig.defaults }

    static func localDay(_ date: Date = .now) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func loadRule() -> BlockRule {
        guard let data = defaults.data(forKey: ruleKey), let rule = try? JSONDecoder().decode(BlockRule.self, from: data) else { return BlockRule() }
        return rule
    }

    static func save(_ rule: BlockRule) {
        if let data = try? JSONEncoder().encode(rule) { defaults.set(data, forKey: ruleKey) }
    }

    static func loadProgress() -> BlockProgress {
        guard let data = defaults.data(forKey: progressKey), let p = try? JSONDecoder().decode(BlockProgress.self, from: data) else { return BlockProgress() }
        return p
    }

    static func save(_ progress: BlockProgress) {
        if let data = try? JSONEncoder().encode(progress) { defaults.set(data, forKey: progressKey) }
    }

    /// True while the picked apps should be blocked.
    static func shouldBlock(_ rule: BlockRule, _ progress: BlockProgress, today: String) -> Bool {
        guard rule.on, rule.hasApps else { return false }
        guard rule.asksForSomething else { return true }
        return progress.focusLeft(rule, today: today) > 0 || progress.tasksLeft(rule) > 0
    }

    /// Puts the block on or takes it off. Returns whether the apps are now blocked.
    @discardableResult
    static func apply(_ rule: BlockRule, _ progress: BlockProgress, today: String) -> Bool {
        let block = shouldBlock(rule, progress, today: today)
        let settings = ManagedSettingsStore(named: store)
        if block {
            let apps = rule.apps
            settings.shield.applications = apps.applicationTokens.isEmpty ? nil : apps.applicationTokens
            settings.shield.applicationCategories = apps.categoryTokens.isEmpty ? nil : .specific(apps.categoryTokens)
            settings.shield.webDomains = apps.webDomainTokens.isEmpty ? nil : apps.webDomainTokens
            settings.shield.webDomainCategories = apps.categoryTokens.isEmpty ? nil : .specific(apps.categoryTokens)
        } else {
            settings.clearAllSettings()
        }
        return block
    }

    /// What is still to do, for the block screen and the app ("20 min of focus and 2 tasks to go").
    static func remaining(_ rule: BlockRule, _ progress: BlockProgress, today: String) -> String {
        var parts: [String] = []
        let minutes = progress.focusLeft(rule, today: today)
        if minutes > 0 { parts.append("\(minutes) min of focus") }
        let tasks = progress.tasksLeft(rule)
        if tasks > 0 { parts.append(tasks == 1 ? "1 task" : "\(tasks) tasks") }
        return parts.isEmpty ? "" : parts.joined(separator: " and ") + " to go"
    }
}
