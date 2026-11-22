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
        .init(id: "1", title: "Run 5k", status: .todo, area: .life),
        .init(id: "2", title: "Call the dentist", status: .todo, area: .life),
        .init(id: "3", title: "Order groceries", status: .todo, area: .life),
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
