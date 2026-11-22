import SwiftUI
import Observation
import WidgetKit

struct Project: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var name: String
    var color: String
    var area: Area?
    var openTasks: Int?
    var doneTasks: Int?
    var madeBy: MadeBy?
    var createdAt: String?

    var ref: ProjectRef { ProjectRef(id: id, name: name, color: color, hex: nil) }
}

/// Every task the dashboard shows, kept in one place so a change made anywhere shows everywhere.
@MainActor @Observable
final class TaskStore {
    static let shared = TaskStore()

    var tasks: [LukeTask] = []
    var view: DashboardView = .standard
    var projects: [Project] = []
    var loaded = false
    var error: String?

    var today: String { AppModel.shared.today }

    private init() {}

    func load() async {
        if !loaded {
            if let cached = await Repo.cached("get_dashboard", as: DashboardAnswer.self) { apply(cached) }
            if let cached = await Repo.cached("list_projects", as: [Project].self) { projects = cached }
        }
        await refresh()
    }

    func refresh() async {
        async let dash = Repo.fetch("get_dashboard", as: DashboardAnswer.self)
        async let projs = Repo.fetch("list_projects", as: [Project].self)
        do {
            apply(try await dash)
            error = nil
        } catch {
            if !loaded { self.error = error.localizedDescription }
        }
        if let p = try? await projs { projects = p }
        loaded = true
        WidgetCenter.shared.reloadAllTimelines()
    }

    private func apply(_ answer: DashboardAnswer) {
        view = answer.view
        AppModel.shared.today = answer.today
        var seen = Set<String>()
        tasks = answer.groups.flatMap(\.tasks).filter { seen.insert($0.id).inserted }
        loaded = true
        saveForWidget()
    }

    func task(_ id: String) -> LukeTask? { tasks.first { $0.id == id } }

    func projects(in area: Area) -> [Project] { projects.filter { ($0.area ?? .work) == area } }

    // MARK: Sorting

    func sorted(_ list: [LukeTask]) -> [LukeTask] {
        let statusRank: [TaskStatus: Int] = [.doing: 0, .todo: 1, .done: 2]
        return list.sorted { a, b in
            if statusRank[a.status]! != statusRank[b.status]! { return statusRank[a.status]! < statusRank[b.status]! }
            for rule in view.sort {
                let ka = key(a, rule.by), kb = key(b, rule.by)
                if ka == kb { continue }
                guard let ka else { return false }
                guard let kb else { return true }
                let flip = (rule.dir == "asc" ? -1 : 1) * (rule.by == "project" || rule.by == "name" ? -1 : 1)
                let c = ka < kb ? -1 : 1
                return c * flip < 0
            }
            return Self.standardOrder(a, b)
        }
    }

    static func standardOrder(_ a: LukeTask, _ b: LukeTask) -> Bool {
        let statusRank: [TaskStatus: Int] = [.doing: 0, .todo: 1, .done: 2]
        if a.status != b.status { return statusRank[a.status]! < statusRank[b.status]! }
        if (a.dueDate ?? "9999") != (b.dueDate ?? "9999") { return (a.dueDate ?? "9999") < (b.dueDate ?? "9999") }
        if (a.priority?.rank ?? 3) != (b.priority?.rank ?? 3) { return (a.priority?.rank ?? 3) < (b.priority?.rank ?? 3) }
        return a.createdAt < b.createdAt
    }

    private func key(_ t: LukeTask, _ by: String) -> String? {
        switch by {
        case "priority": t.priority.map { "\($0.rank)" }
        case "effort": t.effort.map { "\($0.rank)" }
        case "project": t.project?.name.lowercased()
        case "name": t.title.lowercased()
        case "created": String(UInt64.max - UInt64((Stamp.date(t.createdAt)?.timeIntervalSince1970 ?? 0) * 1000))
        default: nil
        }
    }

    /// Tasks just ticked stay on screen a moment (as on the web) so the filled circle is seen.
    var lingering: Set<String> = []

    func shows(_ t: LukeTask) -> Bool { view.show.contains(t.status) || lingering.contains(t.id) }

    // MARK: Changes

    /// Changes fields of a task: shown at once, then saved. `changes` uses the operation's field names.
    func update(_ id: String, _ changes: Input, undoLabel: String? = nil) {
        guard let index = tasks.firstIndex(where: { $0.id == id }) else {
            Task { await Repo.change("update_task", changes.merging(["id": .string(id)]) { $1 }) }
            return
        }
        let before = tasks[index]
        var after = before
        apply(changes, to: &after)
        withAnimation(Motion.snappy) { tasks[index] = after }
        let wasDone = before.status != .done && after.status == .done
        if wasDone { Haptics.success() }
        ScreenTime.shared.noted(after)
        Task {
            if let data = await Repo.change("update_task", changes.merging(["id": .string(id)]) { $1 }),
               let fresh = try? LukeAPI.decoder.decode(LukeTask.self, from: data),
               let i = tasks.firstIndex(where: { $0.id == id }) {
                tasks[i] = fresh
            }
            if wasDone, before.repeat != nil { await refresh() }
            saveForWidget()
        }
        if let undoLabel {
            Toasts.shared.show(undoLabel) { [weak self] in self?.restore(before) }
        }
    }

    func setStatus(_ task: LukeTask, _ status: TaskStatus) {
        update(task.id, ["status": .string(status.rawValue)])
    }

    func toggle(_ task: LukeTask) {
        if task.status == .done {
            setStatus(task, .todo)
            return
        }
        lingering.insert(task.id)
        setStatus(task, .done)
        Task {
            try? await Task.sleep(for: .milliseconds(450))
            _ = withAnimation(Motion.snappy) { lingering.remove(task.id) }
        }
        Toasts.shared.show("Done") { [weak self] in self?.setStatus(task, task.status) }
    }

    /// Puts a task back as it was (Undo).
    func restore(_ t: LukeTask) {
        update(t.id, Self.fields(of: t))
    }

    static func fields(of t: LukeTask) -> Input {
        [
            "title": .string(t.title), "projectId": .optional(t.project?.id), "status": .string(t.status.rawValue),
            "bucket": .string(t.bucket.rawValue), "dueDate": .optional(t.dueDate), "priority": .optional(t.priority?.rawValue),
            "effort": .optional(t.effort?.rawValue), "area": .string(t.area.rawValue), "timeOfDay": .string(t.timeOfDay.rawValue),
            "lane": .string(t.lane.rawValue), "notes": .optional(t.notes), "repeat": .optional(t.repeat),
        ]
    }

    private func apply(_ changes: Input, to t: inout LukeTask) {
        for (key, value) in changes {
            switch key {
            case "title": t.title = value.stringValue ?? t.title
            case "status": t.status = TaskStatus(rawValue: value.stringValue ?? "") ?? t.status
            case "bucket": t.bucket = Bucket(rawValue: value.stringValue ?? "") ?? t.bucket
            case "dueDate": t.dueDate = value.stringValue
            case "priority": t.priority = value.stringValue.flatMap(Priority.init)
            case "effort": t.effort = value.stringValue.flatMap(Effort.init(rawValue:))
            case "area": t.area = Area(rawValue: value.stringValue ?? "") ?? t.area
            case "timeOfDay": t.timeOfDay = TimeOfDay(rawValue: value.stringValue ?? "") ?? t.timeOfDay
            case "lane": t.lane = Lane(rawValue: value.stringValue ?? "") ?? t.lane
            case "notes": t.notes = value.stringValue
            case "repeat": t.repeat = value.stringValue
            case "projectId":
                if let pid = value.stringValue, let p = projects.first(where: { $0.id == pid }) {
                    t.project = p.ref
                    t.area = p.area ?? .work
                } else if value.isNull { t.project = nil }
            default: break
            }
        }
        if changes["status"] != nil { t.completedAt = t.status == .done ? ISO8601DateFormatter.withFractional.string(from: .now) : nil }
    }

    /// Adds a task. Its id is made here, so it's real from the first moment and works offline.
    @discardableResult
    func create(_ input: Input) async -> LukeTask {
        var input = input
        let id = UUID().uuidString.lowercased()
        input["id"] = .string(id)
        var draft = LukeTask(id: id, title: input["title"]?.stringValue ?? "")
        apply(input, to: &draft)
        if input["bucket"] == nil { draft.bucket = Day.bucket(for: draft.dueDate, today: today) }
        withAnimation(Motion.snappy) { tasks.append(draft) }
        saveForWidget()
        if let data = await Repo.change("create_task", input),
           let created = try? LukeAPI.decoder.decode(LukeTask.self, from: data),
           let i = tasks.firstIndex(where: { $0.id == id }) {
            tasks[i] = created
        }
        return draft
    }

    func delete(_ task: LukeTask) {
        withAnimation(Motion.snappy) { tasks.removeAll { $0.id == task.id } }
        Task { await Repo.change("delete_task", ["id": .string(task.id)]) }
        Toasts.shared.show("Moved to Trash") { [weak self] in
            Task {
                await Repo.change("restore_from_trash", ["type": "task", "id": .string(task.id)])
                await self?.refresh()
            }
        }
        saveForWidget()
    }

    // MARK: Widget

    /// What the Today widget shows, kept in the shared container.
    func saveForWidget() {
        // In the dashboard's order, so each widget lists them as the app does.
        let todays = sorted(tasks.filter { $0.bucket == .today && $0.status != .done })
        let snapshot = WidgetSnapshot(today: today, area: AppModel.shared.area, tasks: todays.prefix(40).map {
            WidgetSnapshot.Item(id: $0.id, title: $0.title, status: $0.status, area: $0.area, project: $0.project?.name,
                                projectColor: $0.project?.color, dueDate: $0.dueDate, timeOfDay: $0.timeOfDay)
        })
        snapshot.save()
        WidgetCenter.shared.reloadTimelines(ofKind: "TodayTasks")
        WidgetCenter.shared.reloadTimelines(ofKind: "DayPlan")
    }
}

enum Haptics {
    @MainActor static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    @MainActor static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    @MainActor static func select() { UISelectionFeedbackGenerator().selectionChanged() }
}
