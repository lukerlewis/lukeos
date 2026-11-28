import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// The widget and Live Activity views, shared so the app can show them in its debug gallery.

struct TodayEntry: TimelineEntry {
    var date: Date
    var snapshot: WidgetSnapshot?
    /// Tasks just ticked on the widget: they stay put with a filled tick until the next entry.
    var ticked: Set<String> = []
}

/// The widget's tick button. A Toggle, not a Button: iOS flips a widget toggle the instant it's tapped,
/// before the intent runs, so the filled tick shows straight away instead of after the save and redraw.
struct WidgetTickToggle: View {
    var task: WidgetSnapshot.Item
    var body: some View {
        Toggle(isOn: task.status == .done, intent: TickTaskIntent(taskId: task.id)) { EmptyView() }
            .toggleStyle(WidgetTickStyle(doing: task.status == .doing))
    }
}

struct WidgetTickStyle: ToggleStyle {
    var doing = false
    func makeBody(configuration: Configuration) -> some View {
        WidgetTick(status: configuration.isOn ? .done : doing ? .doing : .todo)
            .contentShape(.circle)
    }
}

/// The widget's tick circle: empty, ringed in ink for Doing, or solid with a tick once ticked.
struct WidgetTick: View {
    var status: TaskStatus
    var size: CGFloat = Size.tick - 4

    var body: some View {
        ZStack {
            if status == .done {
                Circle().fill(Color.ink)
                Image(systemName: "checkmark")
                    .font(.system(size: size * 0.45, weight: .medium))
                    .foregroundStyle(Color.onSolid)
            } else {
                Circle().strokeBorder(status == .doing ? Color.ink : Color.icon, lineWidth: 1.5)
            }
        }
        .frame(width: size, height: size)
    }
}

extension WidgetSnapshot {
    static let sample = WidgetSnapshot(today: Day.today(), area: .life, tasks: [
        .init(id: "1", title: "Run 5k", status: .todo, area: .life, timeOfDay: .morning),
        .init(id: "2", title: "Stretch", status: .todo, area: .life, timeOfDay: .morning),
        .init(id: "3", title: "Call the dentist", status: .todo, area: .life, timeOfDay: .day),
        .init(id: "4", title: "Order groceries", status: .todo, area: .life, timeOfDay: .day),
        .init(id: "5", title: "Pick up dry cleaning", status: .todo, area: .life, timeOfDay: .day),
        .init(id: "6", title: "Read for 20 minutes", status: .todo, area: .life, timeOfDay: .evening),
    ])
}

struct TodayWidgetView: View {
    var entry: TodayEntry
    /// Set only by the app's debug gallery; the widget reads its real size.
    var familyOverride: WidgetFamily?
    @Environment(\.widgetFamily) private var envFamily
    private var family: WidgetFamily { familyOverride ?? envFamily }

    private var tasks: [WidgetSnapshot.Item] {
        guard let s = entry.snapshot else { return [] }
        return s.tasks.filter { $0.area == s.area && ($0.status != .done || entry.ticked.contains($0.id)) }
    }

    var body: some View {
        switch family {
        case .systemSmall: small
        case .accessoryRectangular: rectangular
        default: list(limit: family == .systemLarge ? 9 : 4)
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text("Today").font(.geist(.meta, medium: true)).foregroundStyle(Color.mutedText)
            Text("\(tasks.count)").font(.geist(.display, medium: true)).foregroundStyle(Color.ink)
            Spacer(minLength: 0)
            if let next = tasks.first {
                Text(next.title).font(.geist(.preview)).foregroundStyle(Color.text).lineLimit(2)
            } else {
                Text("All done").font(.geist(.preview)).foregroundStyle(Color.mutedText)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(URL(string: "lukeos://open?path=/"))
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text("Today · \(tasks.count)").font(.geist(.tag, medium: true))
            ForEach(tasks.prefix(2)) { t in Text(t.title).font(.geist(.tag)).lineLimit(1) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func list(limit: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Today").font(.geist(.heading, medium: true)).tracking(-0.68).foregroundStyle(Color.ink)
                Text("\(tasks.count)").font(.geist(.meta)).foregroundStyle(Color.mutedText)
                Spacer()
                Link(destination: URL(string: "lukeos://add-task")!) {
                    Image(systemName: "plus").font(.icon(.meta)).foregroundStyle(Color.ink)
                        .frame(width: Size.iconColumn, height: Size.iconColumn).background(Color.muted, in: .circle)
                }
            }
            .padding(.bottom, Space.line)
            if tasks.isEmpty {
                Spacer()
                Text("All done").font(.geist(.preview)).foregroundStyle(Color.mutedText).frame(maxWidth: .infinity)
                Spacer()
            }
            ForEach(tasks.prefix(limit)) { t in
                HStack(spacing: Space.m) {
                    WidgetTickToggle(task: t.status == .doing ? { var c = t; c.status = .todo; return c }() : t)
                    Link(destination: URL(string: "lukeos://open?path=/?task=\(t.id)")!) {
                        Text(t.title).font(.geist(.preview)).foregroundStyle(Color.text).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    if let c = t.projectColor { Circle().fill(Color.project(c)).frame(width: Size.dotSmall, height: Size.dotSmall) }
                }
                .frame(height: Size.smallButton - 4)
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: Day plan

/// The large widget: Life's Today list in its Morning, Day and Evening cards, each task tickable.
struct DayPlanWidgetView: View {
    var entry: TodayEntry
    /// Points under the header for the parts on a large widget (more push the top off the edge).
    var partsHeight: CGFloat = 296
    static let rowHeight: CGFloat = 28
    static let headingHeight: CGFloat = 24
    static let partGap: CGFloat = Space.xl
    /// Space between a Morning, Day or Evening heading and its first task.
    static let headingGap: CGFloat = 6

    private var tasks: [WidgetSnapshot.Item] {
        (entry.snapshot?.tasks ?? []).filter { $0.area == .life && ($0.status != .done || entry.ticked.contains($0.id)) }
    }
    private func tasks(_ time: TimeOfDay) -> [WidgetSnapshot.Item] {
        tasks.filter { ($0.timeOfDay ?? .day) == time }
    }

    /// Rows per part, filled in time-of-day order: all of Morning first, then Day, then Evening,
    /// until the widget is full. Parts with nothing (or no room) are left off.
    private var allotment: [(TimeOfDay, Int)] {
        var left = partsHeight
        var out: [(TimeOfDay, Int)] = []
        for time in TimeOfDay.allCases {
            let count = tasks(time).count
            guard count > 0 else { continue }
            let gap = out.isEmpty ? 0 : Self.partGap
            let room = Int(((left - gap - Self.headingHeight) / Self.rowHeight).rounded(.down))
            guard room > 0 else { break }
            let rows = min(count, room)
            out.append((time, rows))
            left -= gap + Self.headingHeight + CGFloat(rows) * Self.rowHeight
        }
        return out
    }

    var body: some View {
        let allot = allotment
        VStack(alignment: .leading, spacing: Space.m) {
            HStack {
                Text("Today").font(.geist(.heading, medium: true)).tracking(-0.68).foregroundStyle(Color.ink)
                Text("\(tasks.count)").font(.geist(.meta)).foregroundStyle(Color.mutedText).contentTransition(.numericText())
                Spacer()
                Link(destination: URL(string: "lukeos://add-task?area=life")!) {
                    Image(systemName: "plus").font(.icon(.meta)).foregroundStyle(Color.ink)
                        .frame(width: Size.iconColumn, height: Size.iconColumn).background(Color.muted, in: .circle)
                }
            }
            if tasks.isEmpty {
                Spacer()
                Text("All done").font(.geist(.preview)).foregroundStyle(Color.mutedText).frame(maxWidth: .infinity)
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: Space.xl) {
                    ForEach(allot, id: \.0) { time, rows in
                        part(time, limit: rows)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func part(_ time: TimeOfDay, limit: Int) -> some View {
        let all = tasks(time)
        return VStack(alignment: .leading, spacing: 0) {
            Link(destination: URL(string: "lukeos://add-task?area=life&time=\(time.rawValue)")!) {
                HStack(spacing: Space.s) {
                    Image(systemName: time.symbol).font(.icon(.meta)).foregroundStyle(Color.icon)
                        .frame(width: Size.tick - 4)
                    Text(time.label).font(.geist(.meta, medium: true)).foregroundStyle(Color.mutedText)
                    if all.count > limit {
                        Text("+\(all.count - limit)").font(.geist(.meta)).foregroundStyle(Color.mutedText)
                    }
                    Spacer(minLength: 0)
                }
                .frame(height: Self.headingHeight - Self.headingGap)
            }
            .padding(.bottom, Self.headingGap)
            ForEach(all.prefix(limit)) { t in
                HStack(spacing: Space.m) {
                    WidgetTickToggle(task: t)
                    Link(destination: URL(string: "lukeos://open?path=/?task=\(t.id)")!) {
                        Text(t.title).font(.geist(.preview)).foregroundStyle(Color.text).lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .frame(height: Self.rowHeight)
                .transition(.opacity)
            }
        }
    }
}

// MARK: Quick add

/// One tap into a new task or a new note, with the keyboard already up.
struct QuickAddWidgetView: View {
    enum Kind { case task, note }
    var kind: Kind
    var familyOverride: WidgetFamily?
    @Environment(\.widgetFamily) private var envFamily
    private var family: WidgetFamily { familyOverride ?? envFamily }

    private var url: URL { URL(string: kind == .task ? "lukeos://add-task" : "lukeos://new-note")! }
    private var symbol: String { kind == .task ? "plus" : "square.and.pencil" }
    private var label: String { kind == .task ? "New task" : "New note" }

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: symbol).font(.icon(.transport, weight: .medium))
            }
            .widgetURL(url)
        case .systemMedium where kind == .task:
            // Straight into Morning, Day or Evening.
            HStack(spacing: Space.s) {
                ForEach(TimeOfDay.allCases, id: \.self) { time in
                    Link(destination: URL(string: "lukeos://add-task?area=life&time=\(time.rawValue)")!) {
                        tile(symbol: time.symbol, label: time.label)
                    }
                }
            }
        default:
            tile(symbol: symbol, label: label).widgetURL(url)
        }
    }

    private func tile(symbol: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Image(systemName: symbol).font(.icon(.bar, weight: .medium)).foregroundStyle(Color.ink)
                .frame(width: 44, height: 44).background(Color.muted, in: .circle)
            Spacer(minLength: 0)
            Text(label).font(.geist(.control, medium: true)).foregroundStyle(Color.ink)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// Ticks a task from the widget: shows it ticked straight away, saves it to LukeOS, and the widget's
/// timeline takes it off a moment later.
struct TickTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Tick a task"
    static let isDiscoverable = false

    @Parameter(title: "Task") var taskId: String

    init() {}
    init(taskId: String) { self.taskId = taskId }

    func perform() async throws -> some IntentResult {
        if var snap = WidgetSnapshot.load(), let i = snap.tasks.firstIndex(where: { $0.id == taskId }) {
            snap.tasks[i].status = .done
            snap.tasks[i].tickedAt = .now
            snap.save()
            // Redraw now so the filled tick shows while the save goes through.
            WidgetCenter.shared.reloadTimelines(ofKind: "TodayTasks")
            WidgetCenter.shared.reloadTimelines(ofKind: "DayPlan")
        }
        _ = try? await LukeAPI.shared.opData("update_task", ["id": .string(taskId), "status": "done"])
        return .result()
    }
}

struct FocusActivityView: View {
    var state: FocusActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            HStack(alignment: .firstTextBaseline) {
                Text(state.label).font(.geist(.control, medium: true)).foregroundStyle(Color.mutedText)
                Spacer()
                Group {
                    if let end = state.endsAt { Text(timerInterval: .now...end, countsDown: true) }
                    else if let start = state.startedAt { Text(start, style: .timer) }
                    else { Text(state.pausedText ?? "") }
                }
                .font(.geist(.display, medium: true))
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
                .foregroundStyle(Color.ink)
            }
            if let end = state.endsAt, let start = state.progressStart {
                ProgressView(timerInterval: start...end, countsDown: true) { EmptyView() } currentValueLabel: { EmptyView() }
                    .tint(Color.ink)
            } else if state.endsAt == nil && state.startedAt == nil {
                Label("Paused", systemImage: "pause.fill").font(.geist(.meta, medium: true)).foregroundStyle(Color.mutedText)
            }
        }
    }
}
