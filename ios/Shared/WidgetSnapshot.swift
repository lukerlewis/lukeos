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
