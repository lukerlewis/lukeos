import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings

/// How hard a protocol is to get out of while it is blocking.
enum Strictness: String, Codable, CaseIterable {
    /// Luke can switch it off whenever he likes.
    case easy
    /// Luke asks to unlock, waits, and the apps then open for a while.
    case cooldown
    /// No way out except doing what the protocol asks.
    case strict

    var label: String {
        switch self {
        case .easy: "Off any time"
        case .cooldown: "Cooldown"
        case .strict: "Until it's done"
        }
    }
}

/// Where a protocol stands right now.
enum BlockState: Equatable {
    /// Switched off, or no apps picked.
    case off
    case blocked
    /// Luke asked to unlock; still blocked until the date.
    case cooling(Date)
    /// The cooldown has passed; the apps are open until the date.
    case open(Date)
    /// Everything the protocol asks for is done.
    case done

    var blocks: Bool {
        switch self {
        case .blocked, .cooling: true
        default: false
        }
    }
}

/// One saved protocol: these apps are blocked until Luke has done what it asks, and this is how
/// hard it is to get out of. With nothing asked (no focus time, no tasks) the apps are blocked for
/// as long as the protocol is on.
///
/// Adding a field later: give it a default and decode it with `decodeIfPresent` in `init(from:)`,
/// so protocols saved by an older build still load.
struct BlockProtocol: Codable, Equatable, Identifiable {
    var id = UUID().uuidString.lowercased()
    var name = ""
    var on = false
    /// The apps, categories and websites Luke picked. Apple only hands out opaque tokens, never names.
    var apps = FamilyActivitySelection()
    /// Minutes of focus needed each day. 0 means focus time isn't asked for.
    var focusMinutes = 0
    /// LukeOS tasks that must be done.
    var taskIds: [String] = []
    var strictness = Strictness.easy
    /// Cooldown: how long Luke waits after asking to unlock.
    var cooldownMinutes = 10
    /// Cooldown: how long the apps then stay open. 0 means the rest of the day.
    var openMinutes = 15
    /// Cooldown: when the wait Luke started ends. Nil when he hasn't asked.
    var unlockAt: Date?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        on = try c.decodeIfPresent(Bool.self, forKey: .on) ?? false
        apps = try c.decodeIfPresent(FamilyActivitySelection.self, forKey: .apps) ?? FamilyActivitySelection()
        focusMinutes = try c.decodeIfPresent(Int.self, forKey: .focusMinutes) ?? 0
        taskIds = try c.decodeIfPresent([String].self, forKey: .taskIds) ?? []
        strictness = try c.decodeIfPresent(Strictness.self, forKey: .strictness) ?? .easy
        cooldownMinutes = try c.decodeIfPresent(Int.self, forKey: .cooldownMinutes) ?? 10
        openMinutes = try c.decodeIfPresent(Int.self, forKey: .openMinutes) ?? 15
        unlockAt = try c.decodeIfPresent(Date.self, forKey: .unlockAt)
    }

    var asksForSomething: Bool { focusMinutes > 0 || !taskIds.isEmpty }
    var hasApps: Bool { !apps.applicationTokens.isEmpty || !apps.categoryTokens.isEmpty || !apps.webDomainTokens.isEmpty }

    /// When the apps lock again after a cooldown.
    var relockAt: Date? {
        guard let unlockAt else { return nil }
        if openMinutes > 0 { return unlockAt.addingTimeInterval(Double(openMinutes) * 60) }
        return Calendar.current.startOfDay(for: unlockAt).addingTimeInterval(86400)
    }

    /// `slack` lets the extension treat a moment that is seconds away as already here (iOS wakes it
    /// a little early or late).
    func state(_ progress: BlockProgress, today: String, now: Date = .now, slack: TimeInterval = 0) -> BlockState {
        guard on, hasApps else { return .off }
        if asksForSomething, progress.focusLeft(self, today: today) == 0, progress.tasksLeft(self) == 0 { return .done }
        if strictness == .cooldown, let unlockAt, let relockAt {
            let t = now.addingTimeInterval(slack)
            if t < unlockAt { return .cooling(unlockAt) }
            if t < relockAt { return .open(relockAt) }
        }
        return .blocked
    }

    /// True while Luke can't switch the protocol off, change it or delete it.
    func locked(_ progress: BlockProgress, today: String, now: Date = .now) -> Bool {
        guard state(progress, today: today, now: now).blocks else { return false }
        switch strictness {
        case .easy: return false
        case .cooldown: return true
        case .strict: return asksForSomething
        }
    }
}

/// What the app last knew about Luke's day, saved so the extensions can read it without the network.
struct BlockProgress: Codable, Equatable {
    /// The day (YYYY-MM-DD) the focus time belongs to.
    var day = ""
    var focusSeconds: Double = 0
    /// Tasks picked in any protocol that are not done yet.
    var openTaskIds: [String] = []

    func focusLeft(_ p: BlockProtocol, today: String) -> Int {
        guard p.focusMinutes > 0 else { return 0 }
        let done = day == today ? Int(focusSeconds / 60) : 0
        return max(0, p.focusMinutes - done)
    }

    func tasksLeft(_ p: BlockProtocol) -> Int { openTaskIds.filter { p.taskIds.contains($0) }.count }
}

/// The one place that decides which apps are blocked, and tells iOS.
/// Used by the app and by the three extensions (daily re-lock and cooldown timing, the block screen,
/// the block screen's buttons). Everything is saved in the App Group.
///
/// To add a new kind of condition later (a time of day, a list, a project): add a field to
/// `BlockProtocol`, what the app knows about it to `BlockProgress`, and a line in `state` and `remaining`.
enum ScreenBlock {
    /// The repeating day that locks the apps again at midnight.
    static var daily: DeviceActivityName { .init("lukeos.daily") }
    /// A protocol's cooldown: iOS wakes the monitor when the wait ends and when the apps lock again.
    static func cooldown(_ id: String) -> DeviceActivityName { .init("lukeos.cooldown.\(id)") }
    /// Each protocol has its own set of blocked apps; iOS blocks the union.
    static func store(_ id: String) -> ManagedSettingsStore { ManagedSettingsStore(named: .init("lukeos.protocol.\(id)")) }

    private static let protocolsKey = "screenTime.protocols"
    private static let legacyRuleKey = "screenTime.rule"
    private static let progressKey = "screenTime.progress"
    private static var defaults: UserDefaults { SharedConfig.defaults }

    static func localDay(_ date: Date = .now) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    // MARK: Saved

    static func loadProtocols() -> [BlockProtocol] {
        if let data = defaults.data(forKey: protocolsKey), let all = try? JSONDecoder().decode([BlockProtocol].self, from: data) {
            return all
        }
        // The first build had a single rule: carry it over as one protocol.
        if let data = defaults.data(forKey: legacyRuleKey), var old = try? JSONDecoder().decode(BlockProtocol.self, from: LegacyRule.withId(data)) {
            defaults.removeObject(forKey: legacyRuleKey)
            ManagedSettingsStore(named: .init("lukeos.block")).clearAllSettings()
            guard old.hasApps || old.asksForSomething else { return [] }
            old.name = "Blocked apps"
            save([old])
            return [old]
        }
        return []
    }

    static func save(_ protocols: [BlockProtocol]) {
        if let data = try? JSONEncoder().encode(protocols) { defaults.set(data, forKey: protocolsKey) }
    }

    static func loadProgress() -> BlockProgress {
        guard let data = defaults.data(forKey: progressKey), let p = try? JSONDecoder().decode(BlockProgress.self, from: data) else { return BlockProgress() }
        return p
    }

    static func save(_ progress: BlockProgress) {
        if let data = try? JSONEncoder().encode(progress) { defaults.set(data, forKey: progressKey) }
    }

    // MARK: Blocking

    /// Forgets cooldowns that have run their course. Returns true if anything changed.
    @discardableResult
    static func tidy(_ protocols: inout [BlockProtocol], now: Date = .now, slack: TimeInterval = 0) -> Bool {
        var changed = false
        for i in protocols.indices {
            guard let relock = protocols[i].relockAt else { continue }
            if protocols[i].strictness != .cooldown || !protocols[i].on || now.addingTimeInterval(slack) >= relock {
                protocols[i].unlockAt = nil
                changed = true
            }
        }
        return changed
    }

    /// Puts each protocol's block on or off.
    static func apply(_ protocols: [BlockProtocol], _ progress: BlockProgress, today: String, now: Date = .now, slack: TimeInterval = 0) {
        for p in protocols {
            let settings = store(p.id)
            if p.state(progress, today: today, now: now, slack: slack).blocks {
                let apps = p.apps
                settings.shield.applications = apps.applicationTokens.isEmpty ? nil : apps.applicationTokens
                settings.shield.applicationCategories = apps.categoryTokens.isEmpty ? nil : .specific(apps.categoryTokens)
                settings.shield.webDomains = apps.webDomainTokens.isEmpty ? nil : apps.webDomainTokens
                settings.shield.webDomainCategories = apps.categoryTokens.isEmpty ? nil : .specific(apps.categoryTokens)
            } else {
                settings.clearAllSettings()
            }
        }
    }

    /// For the extensions: read what is saved, start a new day if it is one, and block or unlock.
    static func settleFromSaved(slack: TimeInterval = 60) {
        let today = localDay()
        var progress = loadProgress()
        if progress.day != today {
            progress.day = today
            progress.focusSeconds = 0
            save(progress)
        }
        var protocols = loadProtocols()
        if tidy(&protocols, slack: slack) { save(protocols) }
        apply(protocols, progress, today: today, slack: slack)
    }

    // MARK: Cooldown

    /// Starts the wait on a cooldown protocol and asks iOS to wake the monitor when it ends and when
    /// the apps should lock again. Returns the protocol as saved.
    @discardableResult
    static func startCooldown(_ id: String, now: Date = .now) -> BlockProtocol? {
        var all = loadProtocols()
        guard let i = all.firstIndex(where: { $0.id == id }), all[i].strictness == .cooldown, all[i].unlockAt == nil else { return nil }
        all[i].unlockAt = now.addingTimeInterval(Double(max(1, all[i].cooldownMinutes)) * 60)
        save(all)
        schedule(all[i], now: now)
        return all[i]
    }

    /// Drops a protocol's wait or open time, so it blocks again.
    static func endCooldown(_ id: String) {
        DeviceActivityCenter().stopMonitoring([cooldown(id)])
        var all = loadProtocols()
        guard let i = all.firstIndex(where: { $0.id == id }), all[i].unlockAt != nil else { return }
        all[i].unlockAt = nil
        save(all)
    }

    /// One stretch of time per cooldown: iOS warns the monitor when the wait is over (unlock) and
    /// tells it when the stretch ends (lock again). iOS won't take a stretch shorter than 15 minutes.
    private static func schedule(_ p: BlockProtocol, now: Date) {
        let center = DeviceActivityCenter()
        let name = cooldown(p.id)
        center.stopMonitoring([name])
        guard let unlockAt = p.unlockAt, let relockAt = p.relockAt else { return }
        let end = max(relockAt, now.addingTimeInterval(16 * 60))
        let parts: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
        let warning = max(1, Int((end.timeIntervalSince(unlockAt) / 60).rounded()))
        let stretch = DeviceActivitySchedule(
            intervalStart: Calendar.current.dateComponents(parts, from: now),
            intervalEnd: Calendar.current.dateComponents(parts, from: end),
            repeats: false,
            warningTime: DateComponents(minute: warning)
        )
        try? center.startMonitoring(name, during: stretch)
    }

    // MARK: Words

    /// What is still to do ("20 min of focus and 2 tasks to go"). Empty when nothing is asked or left.
    static func remaining(_ p: BlockProtocol, _ progress: BlockProgress, today: String) -> String {
        var parts: [String] = []
        let minutes = progress.focusLeft(p, today: today)
        if minutes > 0 { parts.append("\(minutes) min of focus") }
        let tasks = progress.tasksLeft(p)
        if tasks > 0 { parts.append(tasks == 1 ? "1 task" : "\(tasks) tasks") }
        return parts.isEmpty ? "" : parts.joined(separator: " and ") + " to go"
    }

    static func clock(_ date: Date) -> String { date.formatted(date: .omitted, time: .shortened) }

    /// One line for where a protocol stands: "Off", "Blocked", "20 min of focus to go", "Unlocks at 8:05 AM".
    static func summary(_ p: BlockProtocol, _ progress: BlockProgress, today: String, now: Date = .now) -> String {
        switch p.state(progress, today: today, now: now) {
        case .off: return p.on ? "No apps picked" : "Off"
        case .done: return "Done"
        case .cooling(let at): return "Unlocks at \(clock(at))"
        case .open(let until): return "Open until \(clock(until))"
        case .blocked:
            let left = remaining(p, progress, today: today)
            return left.isEmpty ? "Blocked" : left.prefix(1).uppercased() + left.dropFirst()
        }
    }
}

/// The single rule the first build saved (no id, name or strictness).
private enum LegacyRule {
    static func withId(_ data: Data) -> Data {
        guard var object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return data }
        object["id"] = UUID().uuidString.lowercased()
        return (try? JSONSerialization.data(withJSONObject: object)) ?? data
    }
}
