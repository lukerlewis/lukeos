import SwiftUI
import Observation

/// Notes: pinned notes as a sideways row of cards, folders, then every note not in a folder.
struct NotesScreen: View {
    @Environment(AppModel.self) private var app
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            NotesList(folder: nil)
                .navigationDestination(for: NoteRoute.self) { route in
                    switch route {
                    case .note(let id): NoteScreen(noteId: id)
                    case .folder(let f): NotesList(folder: f)
                    }
                }
        }
        .onChange(of: app.pendingLink, initial: true) { _, _ in
            if let link = app.take("/notes/") {
                let id = String(link.dropFirst("/notes/".count)).components(separatedBy: "?").first ?? ""
                if !id.isEmpty { path.append(NoteRoute.note(id)) }
            }
        }
    }
}

enum NoteRoute: Hashable {
    case note(String)
    case folder(Folder)
}

@MainActor @Observable
final class NotesModel {
    var notes: [NoteSummary] = []
    var folders: [Folder] = []
    var results: [NoteSummary]?
    var loaded = false
    let folder: Folder?

    init(folder: Folder?) { self.folder = folder }

    private var input: Input { folder.map { ["folderId": .string($0.id)] } ?? [:] }

    func load() async {
        if !loaded {
            if let c = await Repo.cached("list_notes", input, as: [NoteSummary].self) { notes = c }
            if folder == nil, let c = await Repo.cached("list_folders", as: [Folder].self) { folders = c }
        }
        if let fresh = try? await Repo.fetch("list_notes", input, as: [NoteSummary].self) { notes = fresh }
        if folder == nil, let fresh = try? await Repo.fetch("list_folders", as: [Folder].self) { folders = fresh }
        loaded = true
    }

    func search(_ q: String) async {
        let q = q.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { results = nil; return }
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        results = try? await Repo.fetch("list_notes", ["search": .string(q)], as: [NoteSummary].self)
    }

    func setPinned(_ n: NoteSummary, _ on: Bool) {
        if let i = notes.firstIndex(of: n) { withAnimation(.snappy) { notes[i].pinned = on } }
        Task { await Repo.change("update_note", ["id": .string(n.id), "pinned": .bool(on)]) }
    }

    func move(_ n: NoteSummary, to folder: Folder?) {
        if let i = notes.firstIndex(of: n) { notes[i].folder = folder.map { FolderRef(id: $0.id, name: $0.name) } }
        Task {
            await Repo.change("update_note", ["id": .string(n.id), "folderId": .optional(folder?.id)])
            await load()
        }
    }

    func setProject(_ n: NoteSummary, _ p: Project?) {
        if let i = notes.firstIndex(of: n) { notes[i].project = p?.ref }
        Task { await Repo.change("update_note", ["id": .string(n.id), "projectId": .optional(p?.id)]) }
    }

    func delete(_ n: NoteSummary) {
        withAnimation(.snappy) { notes.removeAll { $0.id == n.id } }
        Task { await Repo.change("delete_note", ["id": .string(n.id)]) }
        Toasts.shared.show("Moved to Trash") { [weak self] in
            Task {
                await Repo.change("restore_from_trash", ["type": "note", "id": .string(n.id)])
                await self?.load()
            }
        }
    }

    /// Makes an empty note with an id chosen here, so it works offline too.
    func newNote() async -> String {
        let id = UUID().uuidString.lowercased()
        var input: Input = ["id": .string(id), "title": "", "content": ""]
        if let folder { input["folderId"] = .string(folder.id) }
        await Repo.change("create_note", input)
        return id
    }
}

struct NotesList: View {
    var folder: Folder?
    @State private var model: NotesModel
    @State private var query = ""
    @State private var projectFilter: Set<String> = []
    @State private var store = TaskStore.shared
    @State private var renaming = false
    @State private var newName = ""
    @State private var creatingFolder = false
    @State private var openNote: String?
    @Environment(\.dismiss) private var dismiss

    init(folder: Folder?) {
        self.folder = folder
        _model = State(initialValue: NotesModel(folder: folder))
    }

    private var filtered: [NoteSummary] {
        projectFilter.isEmpty ? model.notes : model.notes.filter { projectFilter.contains($0.project?.id ?? "") }
    }
    private var pinned: [NoteSummary] { filtered.filter { $0.pinned == true } }
    private var loose: [NoteSummary] { filtered.filter { $0.pinned != true && (folder != nil || $0.folder == nil) } }

    var body: some View {
        List {
            if let results = model.results {
                Section {
                    if results.isEmpty { EmptyNote(text: "No notes found.").listRowBackground(Color.clear) }
                    ForEach(results) { n in noteRow(n) }
                }
            } else {
                if folder == nil, store.projects.contains(where: { p in model.notes.contains { $0.project?.id == p.id } }) {
                    projectChips
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
                if !pinned.isEmpty {
                    Section {
                        PinnedRow(items: pinned.map { PinnedRow.Item(id: $0.id, title: $0.displayTitle, excerpt: $0.excerpt, project: $0.project, madeBy: $0.madeBy) }) { openNote = $0 }
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                    } header: { SectionTitle(text: "Pinned") }
                }
                if folder == nil, !model.folders.isEmpty {
                    Section {
                        ForEach(model.folders) { f in
                            NavigationLink(value: NoteRoute.folder(f)) {
                                HStack(spacing: Space.row) {
                                    Image(systemName: "folder").font(.icon(.row)).foregroundStyle(Color.icon).frame(width: 26)
                                    Text(f.name).textStyle(.control, color: .text)
                                    if let p = f.project { ProjectDot(color: p.color) }
                                    Spacer()
                                    Text("\(f.noteCount ?? 0)").textStyle(.meta, color: .mutedText).monospacedDigit()
                                }
                            }
                            .cardRow()
                        }
                    } header: { SectionTitle(text: "Folders") }
                }
                Section {
                    if model.loaded && loose.isEmpty && pinned.isEmpty {
                        EmptyNote(text: "Nothing here yet.", symbol: "note.text").listRowBackground(Color.clear)
                    }
                    ForEach(loose) { n in noteRow(n) }
                } header: {
                    if !loose.isEmpty { SectionTitle(text: "Notes") }
                }
            }
        }
        .listStyle(.insetGrouped)
        .pageBackground()
        .navigationTitle(folder?.name ?? "Notes")
        .searchable(text: $query, prompt: "Search notes")
        .task(id: query) { await model.search(query) }
        .refreshable { await model.load() }
        .task { await model.load() }
        .navigationDestination(item: $openNote) { NoteScreen(noteId: $0) }
        .toolbar {
            if let folder {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Rename", systemImage: "pencil") { newName = folder.name; renaming = true }
                        Menu("Project", systemImage: "circle.grid.2x1") {
                            Button("None") { Task { await Repo.change("update_folder", ["id": .string(folder.id), "projectId": .null]) } }
                            ForEach(store.projects) { p in
                                Button(p.name) { Task { await Repo.change("update_folder", ["id": .string(folder.id), "projectId": .string(p.id)]) } }
                            }
                        }
                        Button("Delete folder", systemImage: "trash", role: .destructive) {
                            Task { await Repo.change("delete_folder", ["id": .string(folder.id)]); dismiss() }
                        }
                    } label: { Image(systemName: "ellipsis") }
                }
            } else {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { newName = ""; creatingFolder = true } label: { Image(systemName: "folder.badge.plus") }
                        .accessibilityLabel("New folder")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { openNote = await model.newNote() }
                } label: { Image(systemName: "square.and.pencil") }
                    .accessibilityLabel("New note")
            }
        }
        .alert("Rename folder", isPresented: $renaming) {
            TextField("Name", text: $newName)
            Button("Save") {
                if let folder { Task { await Repo.change("update_folder", ["id": .string(folder.id), "name": .string(newName)]) } }
            }
            Button("Cancel", role: .cancel) {}
        }
        .alert("New folder", isPresented: $creatingFolder) {
            TextField("Name", text: $newName)
            Button("Create") {
                Task {
                    await Repo.change("create_folder", ["name": .string(newName)])
                    await model.load()
                }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var projectChips: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Space.s) {
                ChipToggle(label: "All", on: projectFilter.isEmpty) { projectFilter = [] }
                ForEach(store.projects) { p in
                    let count = model.notes.filter { $0.project?.id == p.id }.count
                    if count > 0 {
                        ChipToggle(label: p.name, count: count, color: p.color, on: projectFilter.contains(p.id)) {
                            if projectFilter.contains(p.id) { projectFilter.remove(p.id) } else { projectFilter.insert(p.id) }
                        }
                    }
                }
            }
            .padding(.horizontal, Space.xl)
            .padding(.vertical, Space.xs)
        }
        .scrollIndicators(.hidden)
    }

    private func noteRow(_ n: NoteSummary) -> some View {
        NavigationLink(value: NoteRoute.note(n.id)) { NoteRow(note: n) }
            .cardRow()
            .swipeActions(edge: .leading) {
                Button { model.setPinned(n, !(n.pinned ?? false)) } label: {
                    Label(n.pinned == true ? "Unpin" : "Pin", systemImage: n.pinned == true ? "pin.slash" : "pin")
                }
                .tint(Color.swipePrimary)
            }
            .swipeActions(edge: .trailing) {
                Button(role: .destructive) { model.delete(n) } label: { Label("Delete", systemImage: "trash") }
            }
            .contextMenu {
                Button(n.pinned == true ? "Unpin" : "Pin", systemImage: n.pinned == true ? "pin.slash" : "pin") { model.setPinned(n, !(n.pinned ?? false)) }
                Menu("Move to folder", systemImage: "folder") {
                    Button("No folder") { model.move(n, to: nil) }
                    ForEach(model.folders) { f in Button(f.name) { model.move(n, to: f) } }
                }
                Menu("Project", systemImage: "circle.grid.2x1") {
                    Button("None") { model.setProject(n, nil) }
                    ForEach(store.projects) { p in Button(p.name) { model.setProject(n, p) } }
                }
                Divider()
                Button("Delete", systemImage: "trash", role: .destructive) { model.delete(n) }
            }
    }
}

/// A note in a list: title, when it changed, two lines of text, project dot.
struct NoteRow: View {
    var note: NoteSummary
    var body: some View {
        VStack(alignment: .leading, spacing: Space.line) {
            HStack(spacing: Space.line) {
                Text(note.displayTitle).textStyle(.control, medium: true, color: .ink).lineLimit(1)
                ClaudeMark(madeBy: note.madeBy)
                Spacer(minLength: 4)
                Text(Stamp.relative(note.updatedAt)).textStyle(.meta, color: .mutedText)
            }
            HStack(alignment: .top, spacing: Space.line) {
                if let p = note.project { ProjectDot(color: p.color).padding(.top, Space.line) }
                Text(note.excerpt?.isEmpty == false ? note.excerpt! : "No text")
                    .textStyle(.preview, color: .mutedText)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, Space.xs)
    }
}
