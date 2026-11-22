import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// The widget and Live Activity views, shared so the app can show them in its debug gallery.

struct TodayEntry: TimelineEntry {
    var date: Date
    var snapshot: WidgetSnapshot?
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
        return s.tasks.filter { $0.area == s.area && $0.status != .done }
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
                    Button(intent: TickTaskIntent(taskId: t.id)) {
                        Circle().strokeBorder(Color.icon, lineWidth: 1.5).frame(width: Size.tick - 4, height: Size.tick - 4)
                    }
                    .buttonStyle(.plain)
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
    /// Rows that fit under the three headings on a large widget (more push the top off the edge).
    var rowBudget = 7

    private var tasks: [WidgetSnapshot.Item] {
        (entry.snapshot?.tasks ?? []).filter { $0.area == .life && $0.status != .done }
    }
    private func tasks(_ time: TimeOfDay) -> [WidgetSnapshot.Item] {
        tasks.filter { ($0.timeOfDay ?? .day) == time }
    }

    /// How many rows each part gets: turn about, so a long Morning never hides Evening.
    private var allotment: [TimeOfDay: Int] {
        var left = rowBudget
        var n: [TimeOfDay: Int] = [:]
        let totals = Dictionary(uniqueKeysWithValues: TimeOfDay.allCases.map { ($0, tasks($0).count) })
        while left > 0 {
            var gave = false
            for t in TimeOfDay.allCases where left > 0 && n[t, default: 0] < totals[t]! {
                n[t, default: 0] += 1; left -= 1; gave = true
            }
            if !gave { break }
        }
        return n
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
                    ForEach(TimeOfDay.allCases, id: \.self) { time in
                        part(time, limit: allot[time] ?? 0)
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
            }
            .padding(.bottom, all.isEmpty ? 0 : 2)
            ForEach(all.prefix(limit)) { t in
                HStack(spacing: Space.m) {
                    Button(intent: TickTaskIntent(taskId: t.id)) {
                        Circle().strokeBorder(t.status == .doing ? Color.ink : Color.icon, lineWidth: 1.5)
                            .frame(width: Size.tick - 4, height: Size.tick - 4)
                    }
                    .buttonStyle(.plain)
                    Link(destination: URL(string: "lukeos://open?path=/?task=\(t.id)")!) {
                        Text(t.title).font(.geist(.preview)).foregroundStyle(Color.text).lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .frame(height: 28)
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

/// Ticks a task from the widget: saves it to LukeOS and takes it off the widget straight away.
struct TickTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Tick a task"
    static let isDiscoverable = false

    @Parameter(title: "Task") var taskId: String

    init() {}
    init(taskId: String) { self.taskId = taskId }

    func perform() async throws -> some IntentResult {
        if var snap = WidgetSnapshot.load() {
            snap.tasks.removeAll { $0.id == taskId }
            snap.save()
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
