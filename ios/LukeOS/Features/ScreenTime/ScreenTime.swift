import DeviceActivity
import FamilyControls
import Observation
import SwiftUI

/// The app's side of Screen Time: asks iOS for permission, keeps Luke's saved protocols, reads how
/// his day is going (focus time, the picked tasks) and blocks or unlocks the apps to match.
///
/// The protocols and what the app last knew are saved in the App Group (`ScreenBlock`), so the
/// extensions can read them without the app.
@MainActor @Observable
final class ScreenTime {
    static let shared = ScreenTime()

    /// Changing a protocol saves it and blocks or unlocks straight away.
    var protocols: [BlockProtocol] {
        didSet {
            guard protocols != oldValue else { return }
            ScreenBlock.save(protocols)
            let wanted = Set(protocols.flatMap(\.taskIds))
            progress.openTaskIds.removeAll { !wanted.contains($0) }
            settle()
        }
    }
    private(set) var progress: BlockProgress
    /// Luke has allowed LukeOS to use Screen Time.
    private(set) var allowed = false
    /// The picked tasks as last read, by id.
    private(set) var tasks: [String: LukeTask] = [:]
    /// The time the page is drawn for; ticks while the page is open so countdowns move.
    private(set) var now = Date.now

    var today: String { AppModel.shared.today }
    var focusMinutesToday: Int { progress.day == today ? Int(progress.focusSeconds / 60) : 0 }

    private init() {
        protocols = ScreenBlock.loadProtocols()
        progress = ScreenBlock.loadProgress()
        allowed = AuthorizationCenter.shared.authorizationStatus == .approved
    }

    // MARK: Reading a protocol

    func find(_ id: String) -> BlockProtocol? { protocols.first { $0.id == id } }
    func state(_ p: BlockProtocol) -> BlockState { p.state(progress, today: today, now: now) }
    func locked(_ p: BlockProtocol) -> Bool { p.locked(progress, today: today, now: now) }
    func summary(_ p: BlockProtocol) -> String { ScreenBlock.summary(p, progress, today: today, now: now) }
    func tasks(of p: BlockProtocol) -> [LukeTask] { p.taskIds.compactMap { tasks[$0] } }

    // MARK: Changing protocols

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

    func create() -> BlockProtocol {
        var p = BlockProtocol()
        p.name = "New protocol"
        protocols.append(p)
        return p
    }

    /// Changes one protocol. Does nothing while it is locked, unless the change is the app's own.
    func update(_ id: String, force: Bool = false, _ change: (inout BlockProtocol) -> Void) {
        guard let i = protocols.firstIndex(where: { $0.id == id }), force || !locked(protocols[i]) else { return }
        var p = protocols[i]
        change(&p)
        protocols[i] = p
    }

    func delete(_ id: String) {
        guard let p = find(id), !locked(p) else { return }
        DeviceActivityCenter().stopMonitoring([ScreenBlock.cooldown(id)])
        ScreenBlock.store(id).clearAllSettings()
        protocols.removeAll { $0.id == id }
    }

    /// Adds tasks to a protocol. They count as not done until the server says otherwise.
    func add(_ new: [LukeTask], to id: String) {
        for t in new {
            tasks[t.id] = t
            if t.status != .done, !progress.openTaskIds.contains(t.id) { progress.openTaskIds.append(t.id) }
        }
        update(id) { p in p.taskIds += new.map(\.id).filter { !p.taskIds.contains($0) } }
    }

    /// Cooldown: start the wait. The apps unlock when it ends, even if LukeOS is closed.
    func startCooldown(_ id: String) {
        guard ScreenBlock.startCooldown(id) != nil else { return }
        reload()
    }

    /// Cooldown: give up the wait, or lock again early.
    func endCooldown(_ id: String) {
        ScreenBlock.endCooldown(id)
        reload()
    }

    /// A task changed in the app (ticked, unticked): unlock or block without waiting for the server.
    func noted(_ task: LukeTask) {
        guard protocols.contains(where: { $0.taskIds.contains(task.id) }) else { return }
        tasks[task.id] = task
        progress.openTaskIds.removeAll { $0 == task.id }
        if task.status != .done { progress.openTaskIds.append(task.id) }
        settle()
    }

    /// Moves the page's clock on and blocks or unlocks if a cooldown just ended.
    func tick() {
        let before = protocols.map(state)
        now = .now
        if protocols.map(state) != before { settle() }
    }

    // MARK: Keeping in step

    /// Picks up what the block screen's buttons or the monitor changed while the app was away.
    private func reload() {
        now = .now
        let saved = ScreenBlock.loadProtocols()
        if saved != protocols { protocols = saved } else { settle() }
    }

    /// Reads today's focus time and the picked tasks from the server, then blocks or unlocks.
    /// Called when the app comes to the front, after focus time is saved, and when the page opens.
    func refresh(force: Bool = false) async {
        allowed = AuthorizationCenter.shared.authorizationStatus == .approved
        reload()
        let active = protocols.filter { $0.on || force }
        guard allowed, AppModel.shared.signedIn, !SharedConfig.isDemo, !active.isEmpty else { return }
        var next = progress
        if active.contains(where: { $0.focusMinutes > 0 }),
           let stats = try? await Repo.fetch("get_focus_stats", ["days": .number(1)], as: FocusStats.self) {
            next.day = stats.today
            next.focusSeconds = stats.days.last(where: { $0.date == stats.today })?.seconds ?? 0
        }
        var open: [String] = []
        var gone: Set<String> = []
        var seen = Set<String>()
        for id in active.flatMap(\.taskIds) where seen.insert(id).inserted {
            do {
                let task = try await Repo.fetch("get_task", ["id": .string(id)], as: LukeTask.self)
                tasks[id] = task
                if task.status != .done { open.append(id) }
            } catch let APIError.server(_, code) where code == 404 {
                gone.insert(id)
            } catch {
                // Offline or a hiccup: keep what was known.
                if tasks[id] == nil, let known = TaskStore.shared.task(id) { tasks[id] = known }
                if progress.openTaskIds.contains(id) { open.append(id) }
            }
        }
        // Tasks of protocols that weren't read keep what was known.
        open += progress.openTaskIds.filter { !seen.contains($0) }
        next.openTaskIds = open
        progress = next
        if gone.isEmpty {
            settle()
        } else {
            // A deleted task drops out of every protocol, locked or not.
            var all = protocols
            for i in all.indices { all[i].taskIds.removeAll { gone.contains($0) } }
            protocols = all
        }
    }

    /// Saves what is known, puts each block on or off, and keeps the daily re-lock scheduled.
    private func settle() {
        guard allowed else { return }
        var tidy = protocols
        if ScreenBlock.tidy(&tidy, now: now) {
            protocols = tidy // saves and comes back here
            return
        }
        ScreenBlock.save(progress)
        ScreenBlock.apply(protocols, progress, today: today, now: now)
        let center = DeviceActivityCenter()
        if protocols.contains(where: { $0.on && $0.hasApps }) {
            guard !center.activities.contains(ScreenBlock.daily) else { return }
            let day = DeviceActivitySchedule(intervalStart: DateComponents(hour: 0, minute: 0),
                                             intervalEnd: DateComponents(hour: 23, minute: 59), repeats: true)
            try? center.startMonitoring(ScreenBlock.daily, during: day)
        } else {
            center.stopMonitoring([ScreenBlock.daily])
        }
    }
}
