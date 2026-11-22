import SwiftUI

struct ProjectDetail: Codable, Sendable {
    var id: String
    var name: String
    var color: String
    var openTasks: Int?
    var doneTasks: Int?
    var pipelineColumns: [String]?
    var tasks: [LukeTask]
    var folders: [Folder]?
    var notes: [NoteSummary]?
    var documents: [DocumentSummary]?
}

struct SavedLink: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var url: String
    var title: String?
    var note: String?
    var site: String?
    var pinned: Bool?
}

/// A project: List, Board, Notes and Links.
struct ProjectScreen: View {
    var projectId: String
    @State private var project: ProjectDetail?
    @State private var links: [SavedLink] = []
    @State private var tab = "list"
    @State private var showDone = false
    @State private var editing: LukeTask?
    @State private var adding = false
    @State private var addingLink = false
    @State private var linkURL = ""
    @State private var renaming = false
    @State private var newName = ""
    @State private var confirmDelete = false
    @State private var store = TaskStore.shared
    @Environment(\.dismiss) private var dismiss

    private var tasks: [LukeTask] {
        // Live versions from the store where it has them, so ticks show straight away.
        (project?.tasks ?? []).map { store.task($0.id) ?? $0 }
    }

    var body: some View {
        Group {
            if tab == "board" {
                ScrollView {
                    picker.padding(.horizontal, 20)
                    BoardView(tasks: tasks.filter { $0.status != .done || showDone }, onOpen: { editing = $0 })
                }
            } else {
                List {
                    picker.listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    switch tab {
                    case "notes": notesSection
                    case "links": linksSection
                    default: listSection
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .pageBackground()
        .navigationTitle(project?.name ?? "")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Rename", systemImage: "pencil") { newName = project?.name ?? ""; renaming = true }
                    Menu("Colour", systemImage: "paintpalette") {
                        ForEach(["orange", "blue", "violet", "teal", "pink", "green", "amber", "slate"], id: \.self) { c in
                            Button(c.capitalized) {
                                project?.color = c
                                Task { await Repo.change("update_project", ["id": .string(projectId), "color": .string(c)]); await store.refresh() }
                            }
                        }
                    }
                    Toggle("Show done", isOn: $showDone)
                    if project?.pipelineColumns?.isEmpty == false {
                        NavigationLink(value: MoreRoute.web(path: "/projects/\(projectId)", title: "Pipeline")) { Label("Pipeline", systemImage: "rectangle.split.3x1") }
                    }
                    Divider()
                    Button("Delete project", systemImage: "trash", role: .destructive) { confirmDelete = true }
                } label: { Image(systemName: "ellipsis") }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    if tab == "links" { linkURL = UIPasteboard.general.hasURLs ? (UIPasteboard.general.url?.absoluteString ?? "") : ""; addingLink = true } else { adding = true }
                } label: { Image(systemName: "plus") }
                    .accessibilityLabel(tab == "links" ? "Add link" : "New task")
            }
        }
        .sheet(item: $editing) { TaskEditor(taskId: $0.id, fallback: $0) }
        .sheet(isPresented: $adding, onDismiss: { Task { await load() } }) {
            NewTaskSheet(area: .work, base: ["projectId": .string(projectId)])
        }
        .alert("Add link", isPresented: $addingLink) {
            TextField("https://", text: $linkURL).keyboardType(.URL).textInputAutocapitalization(.never)
            Button("Add") {
                Task { await Repo.change("add_link", ["projectId": .string(projectId), "url": .string(linkURL)]); await loadLinks() }
            }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Rename project", isPresented: $renaming) {
            TextField("Name", text: $newName)
            Button("Save") {
                project?.name = newName
                Task { await Repo.change("update_project", ["id": .string(projectId), "name": .string(newName)]); await store.refresh() }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete this project?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Move to Trash", role: .destructive) {
                Task { await Repo.change("delete_project", ["id": .string(projectId)]); await store.refresh() }
                dismiss()
            }
        } message: { Text("Its tasks, notes and documents go to Trash too.") }
        .task { await load(); await loadLinks() }
        .refreshable { await load(); await loadLinks() }
    }

    private var picker: some View {
        Picker("", selection: $tab) {
            Text("List").tag("list")
            Text("Board").tag("board")
            Text("Notes").tag("notes")
            Text("Links").tag("links")
        }
        .pickerStyle(.segmented)
    }

    private func load() async {
        if let c = await Repo.cached("get_project", ["id": .string(projectId)], as: ProjectDetail.self) { project = c }
        if let f = try? await Repo.fetch("get_project", ["id": .string(projectId)], as: ProjectDetail.self) { project = f }
    }

    private func loadLinks() async {
        if let f = try? await Repo.fetch("list_links", ["projectId": .string(projectId)], as: [SavedLink].self) { links = f }
    }

    @ViewBuilder
    private var listSection: some View {
        let open = tasks.filter { $0.status != .done }.sorted(by: TaskStore.standardOrder)
        let done = tasks.filter { $0.status == .done }
        Section {
            if project != nil && open.isEmpty { EmptyNote(text: "Nothing to do.").listRowBackground(Color.clear) }
            ForEach(open) { t in
                TaskRow(task: t, showProject: false, onOpen: { editing = t })
                    .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
                    .taskRowActions(t, onOpen: { editing = t })
                    .cardRow()
            }
        }
        if showDone, !done.isEmpty {
            Section {
                ForEach(done) { t in
                    TaskRow(task: t, showProject: false, onOpen: { editing = t }).cardRow()
                }
            } header: { SectionTitle(text: "Done") }
        }
    }

    @ViewBuilder
    private var notesSection: some View {
        let docs = project?.documents ?? []
        let notes = project?.notes ?? []
        if !docs.isEmpty {
            Section {
                ForEach(docs) { d in
                    NavigationLink(value: MoreRoute.document(d.id)) { DocumentRow(doc: d) }.cardRow()
                }
            } header: { SectionTitle(text: "Documents") }
        }
        Section {
            if project != nil && notes.isEmpty && docs.isEmpty { EmptyNote(text: "No notes yet.").listRowBackground(Color.clear) }
            ForEach(notes) { n in
                NavigationLink(value: MoreRoute.note(n.id)) { NoteRow(note: n) }.cardRow()
            }
        } header: { if !notes.isEmpty { SectionTitle(text: "Notes") } }
    }

    private var linksSection: some View {
        Section {
            if links.isEmpty { EmptyNote(text: "No links yet.").listRowBackground(Color.clear) }
            ForEach(links) { l in
                Link(destination: URL(string: l.url) ?? URL(string: "https://lukeos-kappa.vercel.app")!) {
                    HStack(spacing: 12) {
                        Image(systemName: l.pinned == true ? "pin.fill" : "link").foregroundStyle(Color.icon).frame(width: 22)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l.title ?? l.url).textStyle(.control, medium: true, color: .ink).lineLimit(1)
                            Text(l.site ?? URL(string: l.url)?.host() ?? "").textStyle(.meta, color: .mutedText)
                            if let note = l.note, !note.isEmpty { Text(note).textStyle(.preview, color: .subtleText).lineLimit(2) }
                        }
                    }
                }
                .cardRow()
                .swipeActions {
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        links.removeAll { $0.id == l.id }
                        Task { await Repo.change("delete_link", ["id": .string(l.id)]) }
                    }
                }
                .swipeActions(edge: .leading) {
                    Button(l.pinned == true ? "Unpin" : "Pin", systemImage: l.pinned == true ? "pin.slash" : "pin") {
                        Task { await Repo.change("update_link", ["id": .string(l.id), "pinned": .bool(!(l.pinned ?? false))]); await loadLinks() }
                    }
                    .tint(Color.swipePrimary)
                }
            }
        }
    }
}

/// Every task, with filters for area, project, status and list.
struct AllTasksScreen: View {
    @State private var tasks: [LukeTask] = []
    @State private var area: Area?
    @State private var status: TaskStatus?
    @State private var bucket: Bucket?
    @State private var projectId: String?
    @State private var editing: LukeTask?
    @State private var store = TaskStore.shared

    private var shown: [LukeTask] {
        tasks.map { store.task($0.id) ?? $0 }.filter {
            (area == nil || $0.area == area) && (status == nil || $0.status == status) && (bucket == nil || $0.bucket == bucket) && (projectId == nil || $0.project?.id == projectId)
        }
        .sorted(by: TaskStore.standardOrder)
    }

    var body: some View {
        List {
            Section {
                if tasks.isEmpty { ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear) }
                ForEach(shown) { t in
                    TaskRow(task: t, onOpen: { editing = t })
                        .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
                        .taskRowActions(t, onOpen: { editing = t })
                        .cardRow()
                }
            } header: {
                Text("\(shown.count) tasks").textStyle(.meta, color: .mutedText).textCase(nil)
            }
        }
        .listStyle(.insetGrouped)
        .pageBackground()
        .navigationTitle("All tasks")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Area", selection: $area) {
                        Text("Both areas").tag(Area?.none)
                        ForEach(Area.allCases, id: \.self) { Text($0.label).tag(Area?.some($0)) }
                    }
                    Picker("Status", selection: $status) {
                        Text("Any status").tag(TaskStatus?.none)
                        ForEach(TaskStatus.allCases, id: \.self) { Text($0.label).tag(TaskStatus?.some($0)) }
                    }
                    Picker("List", selection: $bucket) {
                        Text("Any list").tag(Bucket?.none)
                        ForEach(Bucket.allCases, id: \.self) { Text($0.label).tag(Bucket?.some($0)) }
                    }
                    Picker("Project", selection: $projectId) {
                        Text("Any project").tag(String?.none)
                        ForEach(store.projects) { Text($0.name).tag(String?.some($0.id)) }
                    }
                } label: {
                    Image(systemName: area == nil && status == nil && bucket == nil && projectId == nil ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill")
                }
                .accessibilityLabel("Filters")
            }
        }
        .sheet(item: $editing) { TaskEditor(taskId: $0.id, fallback: $0) }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        if let c = await Repo.cached("list_tasks", ["includeDone": true], as: [LukeTask].self) { tasks = c }
        if let f = try? await Repo.fetch("list_tasks", ["includeDone": true], as: [LukeTask].self) { tasks = f }
        else if tasks.isEmpty, let f = try? await Repo.fetch("list_tasks", as: [LukeTask].self) { tasks = f }
    }
}
