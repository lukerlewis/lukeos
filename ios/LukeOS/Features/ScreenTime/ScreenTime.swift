import DeviceActivity
import FamilyControls
import Observation
import SwiftUI

/// The app's side of Screen Time: asks iOS for permission, keeps Luke's rule, reads how his day is
/// going (focus time, the picked tasks) and blocks or unlocks the apps to match.
///
/// The rule and what the app last knew are saved in the App Group (`ScreenBlock`), so the extension
/// that locks the apps again each morning and the block screen can read them without the app.
@MainActor @Observable
final class ScreenTime {
    static let shared = ScreenTime()

    /// Changing the rule saves it and blocks or unlocks straight away.
    var rule: BlockRule {
        didSet {
            guard rule != oldValue else { return }
            ScreenBlock.save(rule)
            picked.removeAll { !rule.taskIds.contains($0.id) }
            progress.openTaskIds.removeAll { !rule.taskIds.contains($0) }
            settle()
        }
    }
    private(set) var progress: BlockProgress
    /// Luke has allowed LukeOS to use Screen Time.
    private(set) var allowed = false
    private(set) var blocked = false
    /// The picked tasks as last read, for the page.
    private(set) var picked: [LukeTask] = []

    var today: String { AppModel.shared.today }
    var focusMinutesToday: Int { progress.day == today ? Int(progress.focusSeconds / 60) : 0 }
    var remaining: String { ScreenBlock.remaining(rule, progress, today: today) }

    private init() {
        rule = ScreenBlock.loadRule()
        progress = ScreenBlock.loadProgress()
        allowed = AuthorizationCenter.shared.authorizationStatus == .approved
    }

    /// Shows the system's "Allow LukeOS to use Screen Time" prompt.
    func allow() async {
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        } catch {
            Toasts.shared.show("Screen Time wasn't allowed.")
        }
        allowed = AuthorizationCenter.shared.authorizationStatus == .approved
        await refresh(force: true)
    }

    /// Adds tasks to the rule. They count as not done until the server says otherwise.
    func add(_ tasks: [LukeTask]) {
        let new = tasks.filter { !rule.taskIds.contains($0.id) }
        picked += new
        progress.openTaskIds += new.filter { $0.status != .done }.map(\.id)
        rule.taskIds += new.map(\.id)
    }

    func remove(_ id: String) {
        rule.taskIds.removeAll { $0 == id }
    }

    /// A task changed in the app (ticked, unticked): unlock or block without waiting for the server.
    func noted(_ task: LukeTask) {
        guard rule.taskIds.contains(task.id) else { return }
        if let i = picked.firstIndex(where: { $0.id == task.id }) { picked[i] = task }
        progress.openTaskIds.removeAll { $0 == task.id }
        if task.status != .done { progress.openTaskIds.append(task.id) }
        settle()
    }

    /// Reads today's focus time and the picked tasks from the server, then blocks or unlocks.
    /// Called when the app comes to the front, after focus time is saved, and when the page opens.
    func refresh(force: Bool = false) async {
        allowed = AuthorizationCenter.shared.authorizationStatus == .approved
        guard allowed, AppModel.shared.signedIn, !SharedConfig.isDemo, rule.on || force else { settle(); return }
        var next = progress
        if rule.focusMinutes > 0,
           let stats = try? await Repo.fetch("get_focus_stats", ["days": .number(1)], as: FocusStats.self) {
            next.day = stats.today
            next.focusSeconds = stats.days.last(where: { $0.date == stats.today })?.seconds ?? 0
        }
        var tasks: [LukeTask] = []
        var open: [String] = []
        var gone: [String] = []
        for id in rule.taskIds {
            do {
                let task = try await Repo.fetch("get_task", ["id": .string(id)], as: LukeTask.self)
                tasks.append(task)
                if task.status != .done { open.append(id) }
            } catch let APIError.server(_, code) where code == 404 {
                gone.append(id)
            } catch {
                // Offline or a hiccup: keep what was known.
                if let known = picked.first(where: { $0.id == id }) ?? TaskStore.shared.task(id) { tasks.append(known) }
                if progress.openTaskIds.contains(id) { open.append(id) }
            }
        }
        next.openTaskIds = open
        picked = tasks
        progress = next
        if gone.isEmpty { settle() } else { rule.taskIds.removeAll(where: gone.contains) }
    }

    /// Saves what is known, puts the block on or off, and keeps the daily re-lock scheduled.
    private func settle() {
        guard allowed else { blocked = false; return }
        ScreenBlock.save(progress)
        blocked = ScreenBlock.apply(rule, progress, today: today)
        let center = DeviceActivityCenter()
        if rule.on, rule.hasApps {
            guard !center.activities.contains(ScreenBlock.daily) else { return }
            let day = DeviceActivitySchedule(intervalStart: DateComponents(hour: 0, minute: 0),
                                             intervalEnd: DateComponents(hour: 23, minute: 59), repeats: true)
            try? center.startMonitoring(ScreenBlock.daily, during: day)
        } else {
            center.stopMonitoring([ScreenBlock.daily])
        }
    }
}
