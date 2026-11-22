import SwiftUI

enum MoreRoute: Hashable {
    case messages, search, tasks, documents, inspiration, health, screenTime, dictation, trash, settings
    case project(String)
    case document(String)
    case note(String)
    case inspirationItem(String)
    case web(path: String, title: String)
    /// A Health section's page (`HealthSection` raw value), optionally opened on a day.
    case healthSection(String, date: String? = nil)
    case workout(HealthWorkoutRef)
}

/// More: Messages, Search, All tasks, Documents, Inspiration, Health, Screen Time, Dictation, Trash, Settings,
/// then Projects,
/// then the parts that live on the web.
struct MoreScreen: View {
    @Environment(AppModel.self) private var app
    @State private var path = NavigationPath()
    @State private var store = TaskStore.shared
    @State private var home = Home.shared
    @State private var naming = false
    @State private var newName = ""

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    row("Messages", "message", .messages, badge: home.unread)
                    row("Search", "magnifyingglass", .search)
                    row("All tasks", "checklist", .tasks)
                    row("Documents", "doc.text", .documents, count: home.newFromClaude)
                    row("Inspiration", "lightbulb", .inspiration)
                    row("Health", "heart.text.square", .health)
                    row("Screen Time", "hourglass", .screenTime)
                    row("Dictation", "mic", .dictation)
                    row("Trash", "trash", .trash)
                    row("Settings", "gearshape", .settings)
                }
                Section {
                    ForEach(store.projects) { p in
                        NavigationLink(value: MoreRoute.project(p.id)) {
                            HStack(spacing: Space.row) {
                                ProjectDot(color: p.color, size: Size.projectDot + 2).frame(width: Size.iconColumn)
                                Text(p.name).textStyle(.control, color: .text)
                                ClaudeMark(madeBy: p.madeBy)
                                Spacer()
                                if let n = p.openTasks, n > 0 { Text("\(n)").textStyle(.meta, color: .mutedText).monospacedDigit() }
                            }
                        }
                        .cardRow()
                    }
                    Button { newName = ""; naming = true } label: {
                        Label { Text("New project").textStyle(.control, color: .subtleText) } icon: {
                            Image(systemName: "plus").foregroundStyle(Color.icon)
                        }
                    }
                    .cardRow()
                } header: { SectionTitle(text: "Projects") }
                Section {
                    row("Whiteboard", "scribble.variable", .web(path: "/whiteboard", title: "Whiteboard"))
                    row("Work archive", "archivebox", .web(path: "/archive", title: "Work archive"))
                    row("Portfolio", "globe", .web(path: "/portfolio", title: "Portfolio"))
                    row("Agents", "sparkles", .web(path: "/agents", title: "Agents"))
                } header: { SectionTitle(text: "On the web") }
            }
            .listStyle(.insetGrouped)
            .pageBackground()
            .navigationTitle("More")
            .navigationDestination(for: MoreRoute.self, destination: destination)
            .refreshable { await store.refresh(); await home.refresh() }
            .task { await store.load() }
            .alert("New project", isPresented: $naming) {
                TextField("Name", text: $newName)
                Button("Create") {
                    Task {
                        await Repo.change("create_project", ["name": .string(newName)])
                        await store.refresh()
                    }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
        .onChange(of: app.pendingLink, initial: true) { _, _ in route() }
    }

    @ViewBuilder
    private func destination(_ r: MoreRoute) -> some View {
        switch r {
        case .messages: MessagesScreen()
        case .search: SearchScreen()
        case .tasks: AllTasksScreen()
        case .documents: DocumentsScreen()
        case .inspiration: InspirationScreen()
        case .dictation: DictationScreen()
        case .health: HealthScreen()
        case .screenTime: ScreenTimeScreen()
        case .trash: TrashScreen()
        case .settings: SettingsScreen()
        case .project(let id): ProjectScreen(projectId: id)
        case .document(let id): DocumentScreen(documentId: id)
        case .note(let id): NoteScreen(noteId: id)
        case .inspirationItem(let id): InspirationDetail(itemId: id)
        case .web(let p, let t): WebScreen(path: p, title: t)
        case .healthSection(let id, let date):
            if let section = HealthSection(rawValue: id) { HealthSectionScreen(section: section, askedDate: date) } else { HealthScreen() }
        case .workout(let ref): WorkoutScreen(ref: ref)
        }
    }

    private func row(_ title: String, _ symbol: String, _ route: MoreRoute, badge: Int = 0, count: Int = 0) -> some View {
        NavigationLink(value: route) {
            HStack(spacing: Space.row) {
                Image(systemName: symbol).font(.icon(.row)).foregroundStyle(Color.icon).frame(width: Size.iconColumn)
                Text(title).textStyle(.control, color: .text)
                Spacer()
                if count > 0 { UnreadDot() }
                CountBadge(count: badge)
            }
        }
        .cardRow()
    }

    /// Opens a link that belongs to this tab (from a notification, a message, a widget).
    private func route() {
        guard let link = app.pendingLink, app.tab == .more else { return }
        app.pendingLink = nil
        let parts = link.split(separator: "?")[0].split(separator: "/").map(String.init)
        guard let first = parts.first else { return }
        let id = parts.count > 1 ? parts[1] : nil
        switch first {
        case "messages": path.append(MoreRoute.messages)
        case "documents": path.append(id.map(MoreRoute.document) ?? .documents)
        case "projects": path.append(id.map(MoreRoute.project) ?? .tasks)
        case "inspiration": path.append(id.map(MoreRoute.inspirationItem) ?? .inspiration)
        case "search": path.append(MoreRoute.search)
        case "health":
            // "/health/sleep?date=2026-11-21" opens the section on that day, with Health under it.
            path.append(MoreRoute.health)
            if let id, HealthSection(rawValue: id) != nil {
                let date = link.split(separator: "?").dropFirst().first?.split(separator: "&")
                    .first { $0.hasPrefix("date=") }.map { String($0.dropFirst(5)) }
                path.append(MoreRoute.healthSection(id, date: date))
            }
        case "settings": path.append(MoreRoute.settings)
        case "dictation": if path.isEmpty { path.append(MoreRoute.dictation) }
        case "screen-time": path.append(MoreRoute.screenTime)
        case "trash": path.append(MoreRoute.trash)
        case "tasks": path.append(MoreRoute.tasks)
        default: path.append(MoreRoute.web(path: link, title: first.capitalized))
        }
    }
}
