import Foundation

struct MadeBy: Codable, Hashable, Sendable {
    var kind: String
    var name: String?
    var routine: String?

    var isClaude: Bool { kind == "agent" }
    static let luke = MadeBy(kind: "user", name: nil, routine: nil)
}

struct ProjectRef: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var name: String
    var color: String?
    var hex: String?
}

enum TaskStatus: String, Codable, CaseIterable, Sendable {
    case todo, doing, done
    var label: String { ["todo": "To do", "doing": "Doing", "done": "Done"][rawValue]! }
    var next: TaskStatus { self == .done ? .todo : .done }
}

enum Bucket: String, Codable, CaseIterable, Sendable {
    case today, tomorrow, this_week, later
    var label: String { ["today": "Today", "tomorrow": "Tomorrow", "this_week": "This week", "later": "Later"][rawValue]! }
}

enum Priority: String, Codable, CaseIterable, Sendable {
    case low, medium, high
    var label: String { rawValue.capitalized }
    var flames: Int { self == .low ? 1 : self == .medium ? 2 : 3 }
    var rank: Int { self == .high ? 0 : self == .medium ? 1 : 2 }
}

enum Effort: String, Codable, CaseIterable, Sendable {
    case shallow, focus, deep
    var label: String { self == .deep ? "Deep work" : rawValue.capitalized }
    var rank: Int { self == .deep ? 0 : self == .focus ? 1 : 2 }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Effort(rawValue: ["small": "shallow", "medium": "focus", "large": "deep"][raw] ?? raw) ?? .focus
    }
}

enum Area: String, Codable, CaseIterable, Sendable {
    case work, life
    var label: String { rawValue.capitalized }
}

enum TimeOfDay: String, Codable, CaseIterable, Sendable {
    case morning, day, evening
    var label: String { rawValue.capitalized }
    var symbol: String { self == .morning ? "cup.and.saucer" : self == .day ? "sun.max" : "moon" }
}

enum Lane: String, Codable, CaseIterable, Sendable {
    case signal, noise
    var label: String { rawValue.capitalized }
    var symbol: String { self == .signal ? "dot.radiowaves.left.and.right" : "waveform" }
}

struct LukeTask: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var title: String
    var status: TaskStatus
    var bucket: Bucket
    var dueDate: String?
    var priority: Priority?
    var effort: Effort?
    var area: Area
    var timeOfDay: TimeOfDay
    var lane: Lane
    var notes: String?
    var `repeat`: String?
    var project: ProjectRef?
    var cardId: String?
    var completedAt: String?
    var createdAt: String
    var updatedAt: String
    var madeBy: MadeBy

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        status = (try? c.decode(TaskStatus.self, forKey: .status)) ?? .todo
        bucket = (try? c.decode(Bucket.self, forKey: .bucket)) ?? .today
        dueDate = try? c.decodeIfPresent(String.self, forKey: .dueDate)
        priority = try? c.decodeIfPresent(Priority.self, forKey: .priority)
        effort = try? c.decodeIfPresent(Effort.self, forKey: .effort)
        area = (try? c.decode(Area.self, forKey: .area)) ?? .life
        timeOfDay = (try? c.decode(TimeOfDay.self, forKey: .timeOfDay)) ?? .day
        lane = (try? c.decode(Lane.self, forKey: .lane)) ?? .noise
        notes = try? c.decodeIfPresent(String.self, forKey: .notes)
        `repeat` = try? c.decodeIfPresent(String.self, forKey: .repeat)
        project = try? c.decodeIfPresent(ProjectRef.self, forKey: .project)
        cardId = try? c.decodeIfPresent(String.self, forKey: .cardId)
        completedAt = try? c.decodeIfPresent(String.self, forKey: .completedAt)
        createdAt = (try? c.decode(String.self, forKey: .createdAt)) ?? ""
        updatedAt = (try? c.decode(String.self, forKey: .updatedAt)) ?? createdAt
        madeBy = (try? c.decode(MadeBy.self, forKey: .madeBy)) ?? .luke
    }

    init(id: String = UUID().uuidString.lowercased(), title: String, status: TaskStatus = .todo, bucket: Bucket = .today,
         dueDate: String? = nil, priority: Priority? = nil, effort: Effort? = nil, area: Area = .life,
         timeOfDay: TimeOfDay = .day, lane: Lane = .noise, notes: String? = nil, repeat: String? = nil,
         project: ProjectRef? = nil) {
        self.id = id; self.title = title; self.status = status; self.bucket = bucket; self.dueDate = dueDate
        self.priority = priority; self.effort = effort; self.area = area; self.timeOfDay = timeOfDay; self.lane = lane
        self.notes = notes; self.repeat = `repeat`; self.project = project; cardId = nil; completedAt = nil
        createdAt = ISO8601DateFormatter.withFractional.string(from: .now); updatedAt = createdAt; madeBy = .luke
    }
}

struct TodayAnswer: Codable, Sendable {
    var date: String
    var todayList: [LukeTask]
    var overdue: [LukeTask]
    var dueToday: [LukeTask]
    var dueSoon: [LukeTask]
}

struct BoardColumn: Codable, Sendable, Identifiable {
    var id: String
    var title: String
    var tasks: [LukeTask]
}

struct SortRule: Codable, Hashable, Sendable {
    var by: String
    var dir: String
}

struct DashboardView: Codable, Sendable {
    var layout: String
    var show: [TaskStatus]
    var sort: [SortRule]

    static let standard = DashboardView(layout: "list", show: [.todo, .doing], sort: [SortRule(by: "priority", dir: "desc")])
}

struct DashboardAnswer: Codable, Sendable {
    var view: DashboardView
    var today: String
    var groups: [BoardColumn]
}

// MARK: Repeats

enum Repeats {
    static let named: [(String, String)] = [
        ("daily", "Every day"), ("weekdays", "Every weekday"), ("weekly", "Every week"),
        ("monthly", "Every month"), ("yearly", "Every year"),
    ]

    /// "Every day", "Every other week", "Every 3 days".
    static func name(_ repeat: String) -> String {
        if let hit = named.first(where: { $0.0 == `repeat` }) { return hit.1 }
        let parts = `repeat`.split(separator: "_")
        guard parts.count == 3, parts[0] == "every", let n = Int(parts[1]) else { return "Repeats" }
        let unit = String(parts[2])
        let single = String(unit.dropLast())
        if n == 2, single == "day" || single == "week" { return "Every other \(single)" }
        return "Every \(n) \(unit)"
    }

    static func of(_ n: Int, _ unit: String) -> String {
        if n == 1 { return ["days": "daily", "weeks": "weekly", "months": "monthly", "years": "yearly"][unit] ?? "daily" }
        return "every_\(n)_\(unit)"
    }
}
