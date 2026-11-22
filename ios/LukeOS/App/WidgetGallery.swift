import SwiftUI
import WidgetKit

/// Demo only (`-demo -widgetGallery`): the widgets and Live Activity as they draw, for screenshots.
struct WidgetGallery: View {
    private var entry: TodayEntry { TodayEntry(date: .now, snapshot: WidgetSnapshot.load() ?? .sample) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.l) {
                Text("Widgets").textStyle(.title, medium: true, color: .ink)
                HStack(alignment: .top, spacing: Space.l) {
                    tile(TodayWidgetView(entry: entry, familyOverride: .systemSmall), width: 170, height: 170)
                    tile(TodayWidgetView(entry: entry, familyOverride: .accessoryRectangular).foregroundStyle(.white), width: 170, height: 76, dark: true)
                }
                tile(TodayWidgetView(entry: entry, familyOverride: .systemMedium), width: 364, height: 170)
                tile(DayPlanWidgetView(entry: entry), width: 364, height: 382)
                HStack(alignment: .top, spacing: Space.l) {
                    tile(QuickAddWidgetView(kind: .task, familyOverride: .systemSmall), width: 170, height: 170)
                    tile(QuickAddWidgetView(kind: .note, familyOverride: .systemSmall), width: 170, height: 170)
                }
                tile(QuickAddWidgetView(kind: .task, familyOverride: .systemMedium), width: 364, height: 170)
                HStack(spacing: Space.l) {
                    QuickAddWidgetView(kind: .task, familyOverride: .accessoryCircular).foregroundStyle(.white).frame(width: 76, height: 76)
                    QuickAddWidgetView(kind: .note, familyOverride: .accessoryCircular).foregroundStyle(.white).frame(width: 76, height: 76)
                }
                Text("Live Activity").textStyle(.heading, medium: true, color: .ink).padding(.top, Space.s)
                FocusActivityView(state: .init(label: "Focus", endsAt: .now.addingTimeInterval(1260), startedAt: nil, pausedText: nil, countsUp: false, progressStart: .now.addingTimeInterval(-240)))
                    .padding(Space.l)
                    .frame(width: 364)
                    .background(Color.card, in: .rect(cornerRadius: 26))
            }
            .padding(Space.xxl)
        }
        .background(LinearGradient(colors: [Color(white: 0.55), Color(white: 0.3)], startPoint: .top, endPoint: .bottom).ignoresSafeArea())
    }

    private func tile<V: View>(_ v: V, width: CGFloat, height: CGFloat, dark: Bool = false) -> some View {
        v.padding(Space.l)
            .frame(width: width, height: height)
            .background(dark ? AnyShapeStyle(.black.opacity(0.35)) : AnyShapeStyle(Color.card), in: .rect(cornerRadius: 24))
    }
}
