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

// MARK: Focus Live Activity

struct FocusLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FocusActivityAttributes.self) { context in
            FocusActivityView(state: context.state)
                .padding(Space.l)
                .activityBackgroundTint(Color.card)
                .activitySystemActionForegroundColor(Color.ink)
                .widgetURL(URL(string: "lukeos://open?path=/focus"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.label).font(.geist(.preview, medium: true))
                }
                DynamicIslandExpandedRegion(.trailing) { time(context.state).font(.geist(.section, medium: true)).monospacedDigit() }
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

