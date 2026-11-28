import Foundation

/// The Today tasks as the app last saw them, shared with the widget through the App Group.
struct WidgetSnapshot: Codable, Sendable {
    struct Item: Codable, Sendable, Identifiable, Hashable {
        var id: String
        var title: String
        var status: TaskStatus
        var area: Area
        var project: String?
        var projectColor: String?
        var dueDate: String?
        /// Life's Morning, Day or Evening card (older saved copies have none: Day).
        var timeOfDay: TimeOfDay?
        /// When it was ticked on the widget, so the widget can show the filled tick for a moment.
        var tickedAt: Date?
    }

    /// Tasks ticked on the widget this recently still show (ticked) on a fresh timeline.
    static let tickGrace: TimeInterval = 8
    /// How long a ticked task stays on the widget, showing its filled tick, before it goes.
    static let tickHold: TimeInterval = 1.2

    /// The ids of tasks ticked on the widget in the last few seconds.
    func freshlyTicked(at date: Date = .now) -> Set<String> {
        Set(tasks.filter { t in
            guard t.status == .done, let at = t.tickedAt else { return false }
            return date.timeIntervalSince(at) < Self.tickGrace
        }.map(\.id))
    }

    var today: String
    var area: Area
    var tasks: [Item]

    static var file: URL { SharedConfig.containerURL.appending(path: "widget-today.json") }

    func save() {
        try? JSONEncoder().encode(self).write(to: Self.file, options: .atomic)
    }

    static func load() -> WidgetSnapshot? {
        guard let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }
}
