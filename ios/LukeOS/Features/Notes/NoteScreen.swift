import SwiftUI
import PhotosUI

/// One note. Markdown notes are edited natively; a note the app can't fully show as Markdown
/// (tables, raw HTML, saved pages) opens read-only with "Edit on the web".
struct NoteScreen: View {
    var noteId: String
    @Environment(\.dismiss) private var dismiss
    @State private var note: Note?
    @State private var title = ""
    @State private var text = ""
    @State private var saved = true
    @State private var failed = false
    @State private var saveTask: Task<Void, Never>?
    @State private var showComments = false
    @State private var showWeb = false
    @State private var photo: PhotosPickerItem?
    @State private var pickingPhoto = false
    @State private var proxy = EditorProxy()
    @State private var store = TaskStore.shared
    @State private var folders: [Folder] = []
    /// Existing notes open rendered; a tap on the text starts editing.
    @State private var editing = false

    private var editable: Bool { note.map { !$0.isHTML && Markdown.isEditable($0.content) } ?? false }

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
                        if editing || text.isEmpty {
                            MarkdownEditor(text: $text, autoFocus: true, onPhoto: { pickingPhoto = true }, proxy: proxy,
                                           onEndEditing: { withAnimation(Motion.snappy) { editing = false } })
                        
                        } else {
                            MarkdownView(text: text) { line in
                                text = Markdown.toggleCheck(text, line: line)
                                schedule()
                            }
                            .contentShape(.rect)
                            .onTapGesture { withAnimation(Motion.snappy) { editing = true } }
                            Color.clear.frame(height: 200).contentShape(.rect)
                                .onTapGesture { withAnimation(Motion.snappy) { editing = true } }
                        }
                    } else {
                        Text(note.title.isEmpty ? "Untitled" : note.title)
                            .textStyle(.title, medium: true, color: .ink)
                        meta(note)
                        if note.isHTML {
                            Button { showWeb = true } label: {
                                Label("Open page", systemImage: "safari")
                            }
                            .buttonStyle(.bordered)
                        } else {
                            MarkdownView(text: note.content)
                        }
                    }
                } else if failed {
                    EmptyNote(text: "Couldn't open this note.", symbol: "exclamationmark.triangle")
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, Space.section * 2)
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
                if editable, editing {
                    Button("Done") { hideKeyboard(); editing = false }
                        .font(.geist(.control, medium: true))
                } else if editable {
                    Text(saved ? "Saved" : "Saving…").textStyle(.meta, color: .mutedText)
                        .fixedSize()
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showComments = true } label: { Image(systemName: "bubble") }
                    .accessibilityLabel("Comments")
            }
            ToolbarItem(placement: .topBarTrailing) { menu }
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
        HStack(spacing: Space.s) {
            if let p = note.project { ProjectChip(name: p.name, color: p.color) }
            if let f = note.folder { Tag(f.name, symbol: "folder") }
            ClaudeMark(madeBy: note.madeBy)
            if !editable, !note.isHTML {
                Spacer()
                Button("Edit on the web") { showWeb = true }
                    .font(.geist(.meta, medium: true))
                    .foregroundStyle(Color.subtleText)
            }
        }
    }

    private var menu: some View {
        Menu {
            if let note {
                Button(note.pinned == true ? "Unpin" : "Pin", systemImage: note.pinned == true ? "pin.slash" : "pin") {
                    self.note?.pinned = !(note.pinned ?? false)
                    Task { await Repo.change("update_note", ["id": .string(noteId), "pinned": .bool(!(note.pinned ?? false))]) }
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
        if let cached = await Repo.cached("get_note", ["id": .string(noteId)], as: Note.self) { show(cached) }
        do {
            show(try await Repo.fetch("get_note", ["id": .string(noteId)], as: Note.self))
        } catch {
            // A note just made offline isn't on the server yet: start it empty.
            if note == nil { show(Note(id: noteId, title: "", format: "markdown", content: "")) }
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

    private func schedule() {
        guard let note, editable, title != note.title || text != note.content else { return }
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
    }

    private func leave() {
        saveTask?.cancel()
        guard let note else { return }
        if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, editable {
            // An empty note isn't kept.
            Task { await Repo.change("delete_note", ["id": .string(noteId)]) }
        } else if title != note.title || text != note.content {
            Task { await save() }
        }
    }

    private func setFolder(_ f: Folder?) {
        note?.folder = f.map { FolderRef(id: $0.id, name: $0.name) }
        Task { await Repo.change("update_note", ["id": .string(noteId), "folderId": .optional(f?.id)]) }
    }

    private func setProject(_ p: Project?) {
        note?.project = p?.ref
        Task { await Repo.change("update_note", ["id": .string(noteId), "projectId": .optional(p?.id)]) }
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
