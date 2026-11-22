import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct LukeOSWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        FocusLiveActivity()
    }
}

// MARK: Today

struct TodayEntry: TimelineEntry {
    var date: Date
    var snapshot: WidgetSnapshot?
}

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry { TodayEntry(date: .now, snapshot: .sample) }
    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(TodayEntry(date: .now, snapshot: WidgetSnapshot.load() ?? .sample))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        // The app refreshes this whenever it syncs; otherwise check back in half an hour.
        completion(Timeline(entries: [TodayEntry(date: .now, snapshot: WidgetSnapshot.load())], policy: .after(.now.addingTimeInterval(1800))))
    }
}

extension WidgetSnapshot {
    static let sample = WidgetSnapshot(today: Day.today(), area: .life, tasks: [
        .init(id: "1", title: "Run 5k", status: .todo, area: .life),
        .init(id: "2", title: "Call the dentist", status: .todo, area: .life),
        .init(id: "3", title: "Order groceries", status: .todo, area: .life),
    ])
}

/// Today's tasks for the area last shown in the app, with tick buttons.
struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TodayTasks", provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
                .containerBackground(Color.card, for: .widget)
        }
        .configurationDisplayName("Today")
        .description("Your Today list.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
    }
}

struct TodayWidgetView: View {
    var entry: TodayEntry
    @Environment(\.widgetFamily) private var family

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
        VStack(alignment: .leading, spacing: 4) {
            Text("Today").font(.geist(.meta, medium: true)).foregroundStyle(Color.mutedText)
            Text("\(tasks.count)").font(.geist(size: 40, medium: true)).foregroundStyle(Color.ink)
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
        VStack(alignment: .leading, spacing: 1) {
            Text("Today · \(tasks.count)").font(.geist(size: 13, medium: true))
            ForEach(tasks.prefix(2)) { t in Text(t.title).font(.geist(size: 13)).lineLimit(1) }
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
                    Image(systemName: "plus").font(.system(size: 14)).foregroundStyle(Color.ink)
                        .frame(width: 28, height: 28).background(Color.muted, in: .circle)
                }
            }
            .padding(.bottom, 6)
            if tasks.isEmpty {
                Spacer()
                Text("All done").font(.geist(.preview)).foregroundStyle(Color.mutedText).frame(maxWidth: .infinity)
                Spacer()
            }
            ForEach(tasks.prefix(limit)) { t in
                HStack(spacing: 10) {
                    Button(intent: TickTaskIntent(taskId: t.id)) {
                        Circle().strokeBorder(Color.icon, lineWidth: 1.5).frame(width: 18, height: 18)
                    }
                    .buttonStyle(.plain)
                    Link(destination: URL(string: "lukeos://open?path=/?task=\(t.id)")!) {
                        Text(t.title).font(.geist(.preview)).foregroundStyle(Color.text).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    if let c = t.projectColor { Circle().fill(Color.project(c)).frame(width: 6, height: 6) }
                }
                .frame(height: 30)
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

// MARK: Focus Live Activity

struct FocusLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FocusActivityAttributes.self) { context in
            FocusActivityView(state: context.state)
                .padding(18)
                .activityBackgroundTint(Color.card)
                .activitySystemActionForegroundColor(Color.ink)
                .widgetURL(URL(string: "lukeos://open?path=/focus"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.label).font(.geist(.preview, medium: true))
                }
                DynamicIslandExpandedRegion(.trailing) { time(context.state).font(.geist(size: 22, medium: true)).monospacedDigit() }
            } compactLeading: {
                Image(systemName: "timer")
            } compactTrailing: {
                time(context.state).monospacedDigit().frame(maxWidth: 48)
            } minimal: {
                Image(systemName: "timer")
            }
        }
    }

    @ViewBuilder
    func time(_ s: FocusActivityAttributes.ContentState) -> some View {
        if let end = s.endsAt { Text(timerInterval: .now...end, countsDown: true) }
        else if let start = s.startedAt { Text(start, style: .timer) }
        else { Text(s.pausedText ?? "") }
    }
}

struct FocusActivityView: View {
    var state: FocusActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(state.label).font(.geist(.control, medium: true)).foregroundStyle(Color.mutedText)
                Group {
                    if let end = state.endsAt { Text(timerInterval: .now...end, countsDown: true) }
                    else if let start = state.startedAt { Text(start, style: .timer) }
                    else { Text(state.pausedText ?? "") }
                }
                .font(.geist(size: 40, medium: true))
                .monospacedDigit()
                .foregroundStyle(Color.ink)
            }
            Spacer()
            if let end = state.endsAt, let start = state.progressStart {
                ProgressView(timerInterval: start...end, countsDown: true) { EmptyView() } currentValueLabel: { EmptyView() }
                    .progressViewStyle(.circular)
                    .tint(Color.ink)
                    .frame(width: 44, height: 44)
            } else if state.endsAt == nil && state.startedAt == nil {
                Image(systemName: "pause.fill").font(.system(size: 22)).foregroundStyle(Color.mutedText)
            }
        }
    }
}
