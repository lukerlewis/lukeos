import AppIntents
import Foundation

enum ListChoice: String, AppEnum {
    case today, tomorrow, this_week, later
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "List"
    static let caseDisplayRepresentations: [ListChoice: DisplayRepresentation] = [
        .today: "Today", .tomorrow: "Tomorrow", .this_week: "This week", .later: "Later",
    ]
}

/// "Add a task to LukeOS": Siri, Shortcuts and the Action button.
struct AddTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Add a task"
    static let description = IntentDescription("Adds a task to LukeOS. Dates in the name, like “tomorrow”, are picked out.")

    @Parameter(title: "Task", requestValueDialog: "What's the task?") var title: String
    @Parameter(title: "List") var list: ListChoice?

    static var parameterSummary: some ParameterSummary { Summary("Add \(\.$title) to \(\.$list)") }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let today = Day.today()
        let entry = SmartEntry.parse(title, today: today)
        let area = Area(rawValue: SharedConfig.defaults.string(forKey: "area") ?? "") ?? .life
        var input: Input = ["id": .string(UUID().uuidString.lowercased()), "title": .string(entry.title), "area": .string(area.rawValue)]
        if let d = entry.dueDate { input["dueDate"] = .string(d) }
        if let r = entry.repeat { input["repeat"] = .string(r) }
        if let b = list?.rawValue ?? entry.bucket?.rawValue { input["bucket"] = .string(b) }
        _ = try await LukeAPI.shared.opData("create_task", input)
        return .result(dialog: "Added “\(entry.title)”.")
    }
}

struct StartFocusIntent: AppIntent {
    static let title: LocalizedStringResource = "Start a focus timer"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        FocusTimer.shared.state.mode = .pomodoro
        if FocusTimer.shared.state.pomodoro.endsAt == nil { FocusTimer.shared.startPomodoro() }
        AppModel.shared.open("/focus")
        return .result()
    }
}

struct OpenMessagesIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Messages"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AppModel.shared.open("/messages")
        return .result()
    }
}

struct LukeOSShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AddTaskIntent(), phrases: ["Add a task to \(.applicationName)", "New \(.applicationName) task"],
                    shortTitle: "Add task", systemImageName: "plus.circle")
        AppShortcut(intent: StartFocusIntent(), phrases: ["Start focusing in \(.applicationName)", "Start a \(.applicationName) focus timer"],
                    shortTitle: "Start focus", systemImageName: "timer")
        AppShortcut(intent: OpenMessagesIntent(), phrases: ["Open \(.applicationName) messages"],
                    shortTitle: "Messages", systemImageName: "message")
    }
}
