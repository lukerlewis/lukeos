import SwiftUI
import PhotosUI

struct InspirationItem: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var kind: String
    var title: String?
    var url: String?
    var site: String?
    var body: String?
    var note: String?
    var summary: String?
    var tags: [String]?
    var project: ProjectRef?
    var image: String?
    var thumb: String?
    var width: Double?
    var height: Double?
    var file: JSON?
    var madeBy: MadeBy?
    var createdAt: String?

    var ratio: CGFloat { CGFloat((height ?? 1) / max(width ?? 1, 1)) }
}

struct TagCount: Codable, Hashable, Sendable { var tag: String; var count: Int }

/// Inspiration: a two-column masonry of pictures, links, quotes and files, with tag filters and search.
struct InspirationScreen: View {
    @State private var items: [InspirationItem] = []
    @State private var tags: [TagCount] = []
    @State private var tag: String?
    @State private var query = ""
    @State private var photos: [PhotosPickerItem] = []
    @State private var pickingPhotos = false
    @State private var addingLink = false
    @State private var addingText = false
    @State private var newValue = ""

    private var shown: [InspirationItem] {
        items.filter { i in
            (tag == nil || (i.tags ?? []).contains(tag!))
                && (query.isEmpty || [i.title, i.body, i.note, i.summary, i.site].compactMap { $0 }.joined(separator: " ").localizedCaseInsensitiveContains(query)
                    || (i.tags ?? []).contains { $0.localizedCaseInsensitiveContains(query) })
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: Space.row) {
                if !tags.isEmpty { tagBar }
                masonry
                    .padding(.horizontal, Space.m)
                if items.isEmpty { EmptyNote(text: "Nothing saved yet.", symbol: "lightbulb") }
            }
            .padding(.bottom, Size.bottomClearance)
        }
        .pageBackground()
        .navigationTitle("Inspiration")
        .searchable(text: $query, prompt: "Search")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Photos", systemImage: "photo") { pickingPhotos = true }
                    Button("Link", systemImage: "link") { newValue = UIPasteboard.general.hasURLs ? UIPasteboard.general.url?.absoluteString ?? "" : ""; addingLink = true }
                    Button("Text", systemImage: "text.quote") { newValue = ""; addingText = true }
                } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Add")
            }
        }
        .photosPicker(isPresented: $pickingPhotos, selection: $photos, maxSelectionCount: 10, matching: .images)
        .onChange(of: photos) { _, list in Task { await upload(list) } }
        .alert("Save a link", isPresented: $addingLink) {
            TextField("https://", text: $newValue).keyboardType(.URL).textInputAutocapitalization(.never)
            Button("Save") { add(["url": .string(newValue)]) }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Save a quote or idea", isPresented: $addingText) {
            TextField("Text", text: $newValue, axis: .vertical)
            Button("Save") { add(["text": .string(newValue)]) }
            Button("Cancel", role: .cancel) {}
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private var tagBar: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Space.s) {
                ChipToggle(label: "All", on: tag == nil) { tag = nil }
                ForEach(tags, id: \.tag) { (t: TagCount) in
                    tagChip(t)
                }
            }
            .padding(.horizontal, Space.l)
        }
        .scrollIndicators(.hidden)
    }

    private func tagChip(_ t: TagCount) -> ChipToggle {
        ChipToggle(label: t.tag, count: t.count, color: nil, on: tag == t.tag, action: { pick(t.tag) })
    }

    private func pick(_ t: String) { tag = (tag == t) ? nil : t }

    private var masonry: some View {
        let columns = split(shown)
        return HStack(alignment: .top, spacing: Space.m) {
            column(columns[0])
            column(columns[1])
        }
    }

    private func column(_ list: [InspirationItem]) -> some View {
        LazyVStack(spacing: Space.m) {
            ForEach(list) { item in
                NavigationLink(value: MoreRoute.inspirationItem(item.id)) { InspirationCard(item: item) }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button("Delete", systemImage: "trash", role: .destructive) { delete(item) }
                    }
            }
        }
    }

    /// Two columns, each item going to the shorter one.
    private func split(_ list: [InspirationItem]) -> [[InspirationItem]] {
        var cols: [[InspirationItem]] = [[], []]
        var heights: [CGFloat] = [0, 0]
        for i in list {
            let h = i.image != nil ? i.ratio : i.kind == "text" ? 0.7 : 0.5
            let c = heights[0] <= heights[1] ? 0 : 1
            cols[c].append(i)
            heights[c] += h + 0.1
        }
        return cols
    }

    private func load() async {
        if let c = await Repo.cached("list_inspiration", as: [InspirationItem].self) { items = c }
        if let f = try? await Repo.fetch("list_inspiration", as: [InspirationItem].self) { items = f }
        if let t = try? await Repo.fetch("list_inspiration_tags", as: [TagCount].self) { tags = t }
    }

    private func add(_ input: Input) {
        Task {
            await Repo.change("add_inspiration", input)
            await load()
        }
    }

    private func delete(_ item: InspirationItem) {
        items.removeAll { $0.id == item.id }
        Task { await Repo.change("delete_inspiration", ["id": .string(item.id)]) }
    }

    private func upload(_ list: [PhotosPickerItem]) async {
        guard !list.isEmpty else { return }
        photos = []
        for p in list {
            guard let data = try? await p.loadTransferable(type: Data.self), let img = UIImage(data: data),
                  let jpeg = img.shrunk(to: 2400).jpegData(compressionQuality: 0.85) else { continue }
            var req = LukeAPI.shared.request("api/inspiration/upload")
            req.httpMethod = "POST"
            req.setValue("image/jpeg", forHTTPHeaderField: "content-type")
            req.setValue("Photo.jpg", forHTTPHeaderField: "x-file-name")
            req.httpBody = jpeg
            if (try? await LukeAPI.shared.send(req)) == nil { Toasts.shared.show("Couldn't save that picture.") }
        }
        await load()
    }
}

struct InspirationCard: View {
    var item: InspirationItem
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let thumb = item.thumb ?? item.image {
                RemoteImage(path: thumb, contentMode: .fill)
                    .aspectRatio(1 / max(item.ratio, 0.3), contentMode: .fit)
                    .clipped()
            }
            if item.kind == "text", let body = item.body {
                Text(body).textStyle(.preview, color: .text).padding(Space.row).frame(maxWidth: .infinity, alignment: .leading)
            } else if item.image == nil {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Image(systemName: item.kind == "link" ? "link" : item.kind == "video" ? "play.rectangle" : "doc").foregroundStyle(Color.icon)
                    Text(item.title ?? item.url ?? "").textStyle(.preview, medium: true, color: .ink).lineLimit(3)
                    if let site = item.site { Text(site).textStyle(.tag, color: .mutedText) }
                }
                .padding(Space.row)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(Color.card)
        .clipShape(.rect(cornerRadius: Radius.container + 2))
        .overlay(RoundedRectangle(cornerRadius: Radius.container + 2).strokeBorder(Color.hairline, lineWidth: 1))
    }
}

/// One item large, with title, note, tags and where it came from.
struct InspirationDetail: View {
    var itemId: String
    @State private var item: InspirationItem?
    @State private var note = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.row) {
                if let item {
                    if let image = item.image {
                        RemoteImage(path: image).clipShape(.rect(cornerRadius: Radius.container))
                    }
                    if item.kind == "text", let body = item.body {
                        Text(body).textStyle(.section, color: .ink)
                    }
                    if let t = item.title, !t.isEmpty { Text(t).textStyle(.heading, medium: true, color: .ink) }
                    if let url = item.url, let u = URL(string: url) {
                        Link(destination: u) { Label(item.site ?? u.host() ?? url, systemImage: "arrow.up.right.square") }
                            .font(.geist(.preview, medium: true)).foregroundStyle(Color.subtleText)
                    }
                    if let s = item.summary, !s.isEmpty {
                        HStack(alignment: .top, spacing: Space.line) {
                            Image(systemName: "sparkle").font(.icon(.meta)).foregroundStyle(Color.mutedText)
                            Text(s).textStyle(.preview, color: .mutedText)
                        }
                    }
                    if let tags = item.tags, !tags.isEmpty {
                        FlowRow { ForEach(tags, id: \.self) { Tag($0) } }
                    }
                    TextField("Note", text: $note, axis: .vertical)
                        .font(.geist(.body))
                        .padding(Space.m)
                        .background(Color.card, in: .rect(cornerRadius: Radius.control))
                        .onSubmit { save() }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, Space.section * 2)
                }
            }
            .padding(Space.l)
            .padding(.bottom, Size.bottomClearance)
        }
        .pageBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if let url = item?.url.flatMap(URL.init(string:)) { ShareLink(item: url) }
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        Task { await Repo.change("delete_inspiration", ["id": .string(itemId)]) }
                        dismiss()
                    }
                } label: { Image(systemName: "ellipsis") }
            }
        }
        .task {
            if let f = try? await Repo.fetch("get_inspiration", ["id": .string(itemId)], as: InspirationItem.self) { item = f; note = f.note ?? "" }
        }
        .onDisappear(perform: save)
    }

    private func save() {
        guard let item, note != (item.note ?? "") else { return }
        Task { await Repo.change("update_inspiration", ["id": .string(itemId), "note": .string(note)]) }
    }
}
