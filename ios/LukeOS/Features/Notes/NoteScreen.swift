import SwiftUI
import PhotosUI

/// One note. Markdown notes are edited natively; a note the app can't fully show as Markdown
/// (tables, raw HTML, saved pages) opens read-only with "Edit on the web".
/// What happens to a note when Luke leaves it.
enum NoteLeave: Equatable {
    case keep, delete, save

    /// Only a note made in this visit may be thrown away for being empty, and only a note that
    /// actually loaded (or is new) may be saved or deleted at all.
    static func decide(isNew: Bool, loaded: Bool, title: String, text: String, originalTitle: String, originalText: String) -> NoteLeave {
        guard loaded || isNew else { return .keep }
        let empty = title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if isNew && empty { return .delete }
        return title != originalTitle || text != originalText ? .save : .keep
    }
}

/// Saved copies read once per note id, so re-creating the view doesn't read the disk again.
@MainActor
enum SavedCopy {
    private static var notes: [String: Note?] = [:]
    private static var documents: [String: LukeDocument?] = [:]

    static func note(_ id: String) -> Note? {
        if let hit = notes[id] { return hit }
        let n = Repo.cachedNow("get_note", ["id": .string(id)], as: Note.self)
        notes[id] = .some(n)
        return n
    }

    static func document(_ id: String) -> LukeDocument? {
        if let hit = documents[id] { return hit }
        let d = Repo.cachedNow("get_document", ["id": .string(id)], as: LukeDocument.self)
        documents[id] = .some(d)
        return d
    }

    /// Forget a copy once a fresher one has been fetched.
    static func forget(note id: String) { notes[id] = nil }
    static func forget(document id: String) { documents[id] = nil }
}

struct NoteScreen: View {
    var noteId: String
    /// What the list already knows (title), shown at once while the note loads.
    var preview: String? = nil
    /// Made just now (the + button), so it may start empty and be thrown away if left empty.
    var isNew = false
    @Environment(\.dismiss) private var dismiss
    @State private var note: Note?
    @State private var title = ""
    @State private var text = ""

    init(noteId: String, preview: String? = nil, isNew: Bool = false) {
        self.noteId = noteId
        self.preview = preview
        self.isNew = isNew
        // Draw the first frame from the saved copy, so a zoom never opens on a blank page.
        let saved = SavedCopy.note(noteId)
        _note = State(initialValue: saved)
        _loaded = State(initialValue: saved != nil)
        _title = State(initialValue: saved?.title ?? "")
        _text = State(initialValue: saved?.content ?? "")
    }
    @State private var saved = true
    @State private var failed = false
    /// The note really came from the server or the saved copy (not a stand-in).
    @State private var loaded = false
    @State private var saveTask: Task<Void, Never>?
    @State private var showComments = false
    @State private var showWeb = false
    @State private var photo: PhotosPickerItem?
    @State private var pickingPhoto = false
    @State private var proxy = EditorProxy()
    @State private var store = TaskStore.shared
    @State private var folders: [Folder] = []
    /// The keyboard is up in one of the note's text parts.
    @State private var editing = false

    /// Markdown notes are edited (tables stay fixed blocks); saved HTML pages open on the web.
    private var editable: Bool { note.map { !$0.isHTML && !NoteSegments.hasRawHTML($0.content) } ?? false }
    /// The note split into text to edit and tables that stay as they are.
    private var segments: [NoteSegments.Segment] { NoteSegments.split(text) }
    /// A change to this note is waiting to be sent (offline).
    private var unsent: Bool { Outbox.shared.items.contains { $0.name == "update_note" && $0.input["id"]?.stringValue == noteId } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.row) {
                if let note {
                    if editable {
                        TextField("Title", text: $title, axis: .vertical)
                            .font(.geist(.title, medium: true))
                            .tracking(LukeType.title.tracking)
                            .foregroundStyle(Color.ink)
                            .onChange(of: title) { _, _ in schedule() }
                        meta(note)
                        ForEach(Array(segments.enumerated()), id: \.offset) { i, segment in
                            switch segment {
                            case .text(let part):
                                MarkdownEditor(
                                    text: Binding(get: { part }, set: { setSegment(i, $0) }),
                                    autoFocus: note.title.isEmpty && note.content.isEmpty && i == 0,
                                    onPhoto: { pickingPhoto = true }, proxy: i == 0 ? proxy : nil,
                                    onBeginEditing: { editing = true }, onEndEditing: { editing = false }
                                )
                            case .table(let table):
                                VStack(alignment: .leading, spacing: Space.s) {
                                    MarkdownView(text: table)
                                    Button("Edit table on the web") { showWeb = true }
                                        .font(.geist(.meta, medium: true))
                                        .foregroundStyle(Color.mutedText)
                                }
                            }
                        }
                    } else {
                        Text(note.title.isEmpty ? "Untitled" : note.title)
                            .textStyle(.title, medium: true, color: .ink)
                        meta(note)
                        Button { showWeb = true } label: { Label("Open page", systemImage: "safari") }
                            .buttonStyle(.bordered)
                    }
                } else if failed {
                    EmptyNote(text: "Couldn't open this note.", symbol: "exclamationmark.triangle")
                } else {
                    if let preview, !preview.isEmpty {
                        Text(preview).textStyle(.title, medium: true, color: .ink)
                    }
                    DelayedSpinner()
                }
            }
            .padding(.horizontal, Space.xxl)
            .padding(.top, Space.s)
            .padding(.bottom, Size.bottomClearance)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color.card.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showComments = true } label: { Image(systemName: "bubble") }
                    .accessibilityLabel("Comments")
            }
            ToolbarItem(placement: .topBarTrailing) { menu }
            if editing {
                // A separate confirm that puts the keyboard away; saving happens on its own.
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
                ToolbarItem(placement: .topBarTrailing) {
                    Button(role: .confirm) { hideKeyboard() }
                        .accessibilityLabel("Done")
                }
            }
        }
        .sheet(isPresented: $showComments) {
            NavigationStack {
                ScrollView { CommentThreads(targetType: "note", targetId: noteId).padding(Space.xl) }
                    .background(Color.page)
                    .navigationTitle("Comments")
                    .navigationBarTitleDisplayMode(.inline)
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showWeb) { WebSheet(path: "/notes/\(noteId)") }
        .photosPicker(isPresented: $pickingPhoto, selection: $photo, matching: .images)
        .onChange(of: photo) { _, item in if let item { Task { await addPhoto(item) } } }
        .task { await load() }
        .onDisappear(perform: leave)
    }

    private func meta(_ note: Note) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            HStack(spacing: Space.s) {
                if let p = note.project { ProjectChip(name: p.name, color: p.color) }
                if let f = note.folder { Tag(f.name, symbol: "folder") }
                ClaudeMark(madeBy: note.madeBy)
            }
            if unsent {
                Text("Not saved yet").textStyle(.meta, color: .mutedText)
            }
        }
    }

    private var menu: some View {
        Menu {
            if let note {
                Button(note.pinned == true ? "Unpin" : "Pin", systemImage: note.pinned == true ? "pin.slash" : "pin") {
                    self.note?.pinned = !(note.pinned ?? false)
                    Task {
                        await Repo.change("update_note", ["id": .string(noteId), "pinned": .bool(!(note.pinned ?? false))])
                        await rememberNote()
                    }
                }
                Menu("Move to folder", systemImage: "folder") {
                    Button("No folder") { setFolder(nil) }
                    ForEach(folders) { f in Button(f.name) { setFolder(f) } }
                }
                Menu("Project", systemImage: "circle.grid.2x1") {
                    Button("None") { setProject(nil) }
                    ForEach(store.projects) { p in Button(p.name) { setProject(p) } }
                }
                ShareLink(item: "# \(title)\n\n\(text)") { Label("Share", systemImage: "square.and.arrow.up") }
                Button("Open on the web", systemImage: "safari") { showWeb = true }
                Divider()
                Button("Delete", systemImage: "trash", role: .destructive) {
                    saveTask?.cancel()
                    Task { await Repo.change("delete_note", ["id": .string(noteId)]) }
                    Toasts.shared.show("Moved to Trash") {
                        Task { await Repo.change("restore_from_trash", ["type": "note", "id": .string(noteId)]) }
                    }
                    self.note = nil
                    dismiss()
                }
            }
        } label: { Image(systemName: "ellipsis") }
    }

    // MARK: Loading and saving

    private func load() async {
        if let cached = await Repo.cached("get_note", ["id": .string(noteId)], as: Note.self) { show(cached); loaded = true }
        do {
            let fresh = try await Repo.fetch("get_note", ["id": .string(noteId)], as: Note.self)
            // A change of Luke's is still waiting to be sent: the server's copy is older, so keep his.
            if await !Repo.hasPendingChange(for: "get_note", ["id": .string(noteId)]) {
                show(fresh)
                SavedCopy.forget(note: noteId)
            }
            loaded = true
        } catch {
            if note == nil {
                if isNew {
                    // Made just now, offline: it isn't on the server yet, so it starts empty.
                    show(Note(id: noteId, title: "", format: "markdown", content: ""))
                } else {
                    // A note that exists but can't be read now: never stand in an empty one.
                    failed = true
                }
            }
        }
        folders = (try? await Repo.fetch("list_folders", as: [Folder].self)) ?? []
    }

    private func show(_ n: Note) {
        // Don't overwrite what's being typed.
        if note == nil || saved {
            note = n
            title = n.title
            text = n.content
        }
    }

    /// One part of the note changed: put the note back together around the tables, byte for byte.
    private func setSegment(_ i: Int, _ value: String) {
        var parts = segments
        guard parts.indices.contains(i) else { return }
        parts[i] = .text(value)
        text = NoteSegments.join(parts)
        schedule()
    }

    private func schedule() {
        guard let note, editable, loaded || isNew, title != note.title || text != note.content else { return }
        saved = false
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            await save()
        }
    }

    private func save() async {
        guard var n = note else { return }
        let t = title, c = text
        var input: Input = ["id": .string(noteId)]
        if t != n.title { input["title"] = .string(t) }
        if c != n.content { input["content"] = .string(c) }
        guard input.count > 1 else { saved = true; return }
        await Repo.change("update_note", input)
        n.title = t
        n.content = c
        note = n
        saved = true
        await rememberNote()
    }

    /// The note as it now stands becomes the saved copy, sent or still queued.
    private func rememberNote() async {
        guard let note else { return }
        await Repo.remember("get_note", ["id": .string(noteId)], note)
        SavedCopy.forget(note: noteId)
    }

    private func leave() {
        saveTask?.cancel()
        guard let note, editable else { return }
        switch NoteLeave.decide(isNew: isNew, loaded: loaded, title: title, text: text, originalTitle: note.title, originalText: note.content) {
        case .delete: Task { await Repo.change("delete_note", ["id": .string(noteId)]) }
        case .save: Task { await save() }
        case .keep: break
        }
    }

    private func setFolder(_ f: Folder?) {
        note?.folder = f.map { FolderRef(id: $0.id, name: $0.name) }
        Task {
            await Repo.change("update_note", ["id": .string(noteId), "folderId": .optional(f?.id)])
            await rememberNote()
        }
    }

    private func setProject(_ p: Project?) {
        note?.project = p?.ref
        Task {
            await Repo.change("update_note", ["id": .string(noteId), "projectId": .optional(p?.id)])
            await rememberNote()
        }
    }

    /// Shrinks the photo (1600 px, JPEG), saves it to LukeOS, and puts it in the note.
    private func addPhoto(_ item: PhotosPickerItem) async {
        photo = nil
        guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data),
              let jpeg = image.shrunk(to: 1600).jpegData(compressionQuality: 0.82) else { return }
        struct Saved: Decodable { var markdown: String?; var url: String? }
        do {
            let saved = try await Repo.create("save_image", ["data": .string(jpeg.base64EncodedString()), "mimeType": "image/jpeg"], as: Saved.self)
            let md = saved.markdown ?? "![](\(saved.url ?? ""))"
            proxy.insertImage(md)
        } catch {
            Toasts.shared.show(error.localizedDescription)
        }
    }
}

@MainActor func hideKeyboard() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
}

extension UIImage {
    /// The picture with its longest side at most `side` points.
    func shrunk(to side: CGFloat) -> UIImage {
        let scale = min(1, side / max(size.width, size.height))
        guard scale < 1 else { return self }
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
    }
}
