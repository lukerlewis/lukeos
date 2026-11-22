import WidgetKit
import SwiftUI
@main struct LukeOSWidgetBundle: WidgetBundle { var body: some Widget { TodayWidget() } }
struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TodayTasks", provider: P()) { _ in Text("Today") }
    }
    struct E: TimelineEntry { var date: Date }
    struct P: TimelineProvider {
        func placeholder(in context: Context) -> E { E(date: .now) }
        func getSnapshot(in context: Context, completion: @escaping (E) -> Void) { completion(E(date: .now)) }
        func getTimeline(in context: Context, completion: @escaping (Timeline<E>) -> Void) { completion(Timeline(entries: [E(date: .now)], policy: .never)) }
    }
}
