import SwiftUI
import UserNotifications

struct SearchHit: Codable, Hashable, Sendable, Identifiable {
    var type: String
    var id: String
    var title: String
    var snippet: String?
    var status: String?
    var dueDate: String?
    var project: ProjectRef?
    var madeBy: MadeBy?
}

/// One field; results grouped by kind; tapping opens the thing.
struct SearchScreen: View {
    @State private var query = ""
    @State private var hits: [SearchHit] = []
    @State private var searched = false
    @State private var editing: LukeTask?
    @Environment(AppModel.self) private var app

    private let order = ["task", "note", "document", "project", "inspiration", "card", "entry"]
    private let names = ["task": "Tasks", "note": "Notes", "document": "Documents", "project": "Projects", "inspiration": "Inspiration", "card": "Cards", "entry": "Work archive"]

    var body: some View {
        List {
            ForEach(order, id: \.self) { type in
                let group = hits.filter { $0.type == type }
                if !group.isEmpty {
                    Section {
                        ForEach(group) { h in hitRow(h).cardRow() }
                    } header: { SectionTitle(text: names[type] ?? type.capitalized) }
                }
            }
            if searched && hits.isEmpty { EmptyNote(text: "Nothing found.").listRowBackground(Color.clear) }
        }
        .listStyle(.insetGrouped)
        .pageBackground()
        .navigationTitle("Search")
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Tasks, notes, documents…")
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard !q.isEmpty else { hits = []; searched = false; return }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            hits = (try? await Repo.fetch("search", ["query": .string(q)], as: [SearchHit].self)) ?? []
            searched = true
        }
        .sheet(item: $editing) { TaskEditor(taskId: $0.id, fallback: $0) }
    }

    @ViewBuilder
    private func hitRow(_ h: SearchHit) -> some View {
        let label = VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                if h.type == "task" { StatusCircle(status: TaskStatus(rawValue: h.status ?? "") ?? .todo, size: 16) }
                Text(h.title.isEmpty ? "Untitled" : h.title).textStyle(.control, medium: true, color: .ink).lineLimit(1)
                ClaudeMark(madeBy: h.madeBy)
                if let p = h.project { ProjectDot(color: p.color) }
            }
            if let s = h.snippet, !s.isEmpty { Text(s).textStyle(.meta, color: .mutedText).lineLimit(2) }
        }
        switch h.type {
        case "task": Button { editing = TaskStore.shared.task(h.id) ?? LukeTask(id: h.id, title: h.title) } label: { label }.buttonStyle(.plain)
        case "note": NavigationLink(value: MoreRoute.note(h.id)) { label }
        case "document": NavigationLink(value: MoreRoute.document(h.id)) { label }
        case "project": NavigationLink(value: MoreRoute.project(h.id)) { label }
        case "inspiration": NavigationLink(value: MoreRoute.inspirationItem(h.id)) { label }
        case "card": NavigationLink(value: MoreRoute.web(path: "/cards/\(h.id)", title: h.title)) { label }
        default: NavigationLink(value: MoreRoute.web(path: "/archive/\(h.id)", title: h.title)) { label }
        }
    }
}

struct TrashItem: Codable, Hashable, Sendable, Identifiable {
    var type: String
    var id: String
    var title: String?
    var project: ProjectRef?
    var deletedAt: String?
    var deletesOn: String?
}

/// Everything deleted in the last 30 days: Restore, Delete forever, Empty Trash.
struct TrashScreen: View {
    @State private var items: [TrashItem] = []
    @State private var loaded = false
    @State private var confirmEmpty = false

    var body: some View {
        List {
            if loaded && items.isEmpty { EmptyNote(text: "Trash is empty.", symbol: "trash").listRowBackground(Color.clear) }
            ForEach(items) { i in
                VStack(alignment: .leading, spacing: 2) {
                    Text((i.title ?? "").isEmpty ? "Untitled" : i.title!).textStyle(.control, color: .text).lineLimit(1)
                    Text("\(i.type.capitalized) · deleted \(Stamp.relative(i.deletedAt))").textStyle(.meta, color: .mutedText)
                }
                .cardRow()
                .swipeActions(edge: .leading) {
                    Button("Restore", systemImage: "arrow.uturn.backward") { restore(i) }.tint(Color.swipePrimary)
                }
                .swipeActions {
                    Button("Delete forever", systemImage: "trash", role: .destructive) {
                        items.removeAll { $0 == i }
                        Task { await Repo.change("delete_forever", ["type": .string(i.type), "id": .string(i.id)]) }
                    }
                }
                .contextMenu {
                    Button("Restore", systemImage: "arrow.uturn.backward") { restore(i) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .pageBackground()
        .navigationTitle("Trash")
        .toolbar {
            if !items.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Empty") { confirmEmpty = true }.font(.geist(.control, medium: true))
                }
            }
        }
        .confirmationDialog("Empty Trash?", isPresented: $confirmEmpty, titleVisibility: .visible) {
            Button("Delete \(items.count) for good", role: .destructive) {
                items = []
                Task { await Repo.change("empty_trash", [:]) }
            }
        } message: { Text("This can't be undone.") }
        .task {
            items = (try? await Repo.fetch("list_trash", as: [TrashItem].self)) ?? []
            loaded = true
        }
    }

    private func restore(_ i: TrashItem) {
        items.removeAll { $0 == i }
        Task {
            await Repo.change("restore_from_trash", ["type": .string(i.type), "id": .string(i.id)])
            await TaskStore.shared.refresh()
        }
        Toasts.shared.show("Restored")
    }
}

/// Notifications, downloads, appearance, time zone, web settings, sign out.
struct SettingsScreen: View {
    @Environment(AppModel.self) private var app
    @AppStorage("appearance", store: SharedConfig.defaults) private var appearance = "system"
    @State private var notifications: UNAuthorizationStatus = .notDetermined
    @State private var downloads = Downloads.shared
    @State private var confirmSignOut = false
    @State private var showWeb = false
    @State private var outbox = Outbox.shared

    var body: some View {
        Form {
            Section("Notifications") {
                if notifications == .authorized {
                    Label("On", systemImage: "bell.badge").foregroundStyle(Color.text)
                    Button("Send a test") {
                        Task {
                            var req = LukeAPI.shared.request("api/push/test")
                            req.httpMethod = "POST"
                            _ = try? await LukeAPI.shared.send(req)
                            Toasts.shared.show("Sent")
                        }
                    }
                } else if notifications == .denied {
                    Button("Turn on in Settings") { UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!) }
                } else {
                    Button("Turn on") { Task { await Push.registerIfAllowed(ask: true); await check() } }
                }
            }
            Section("Appearance") {
                Picker("Appearance", selection: $appearance) {
                    Text("System").tag("system")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
                .pickerStyle(.segmented)
            }
            Section("Downloads") {
                LabeledContent("Saved on this iPhone", value: "\(downloads.saved.count) · \(ByteCountFormatter.string(fromByteCount: downloads.bytesUsed, countStyle: .file))")
                if !downloads.saved.isEmpty {
                    Button("Remove all downloads", role: .destructive) { downloads.removeAll() }
                }
            }
            Section("Sync") {
                LabeledContent("Time zone", value: TimeZone.current.identifier)
                LabeledContent("Waiting to send", value: outbox.items.isEmpty ? "Nothing" : "\(outbox.items.count)")
                Button("Clear saved copies") { Task { await ResponseCache.shared.clear(); Toasts.shared.show("Cleared") } }
            }
            Section {
                Button("Devices and Claude on the web") { showWeb = true }
            }
            Section {
                Button("Sign out", role: .destructive) { confirmSignOut = true }
            } footer: {
                Text("LukeOS \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))\(SharedConfig.isDemo ? " · Demo" : "")")
                    .font(.geist(.meta))
            }
        }
        .font(.geist(.control))
        .scrollContentBackground(.hidden)
        .background(Color.page)
        .navigationTitle("Settings")
        .sheet(isPresented: $showWeb) { WebSheet(path: "/settings", title: "Settings") }
        .confirmationDialog("Sign out of LukeOS on this iPhone?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) {
                Task {
                    await Push.unregister()
                    await app.signOut()
                }
            }
        }
        .task { await check() }
    }

    private func check() async {
        notifications = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }
}
