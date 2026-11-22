import SwiftUI

struct DocumentSummary: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var title: String
    var excerpt: String?
    var project: ProjectRef?
    var madeBy: MadeBy?
    var updatedAt: String?
    var isNew: Bool?
    var openComments: Int?
    var pinned: Bool?
}

struct LukeDocument: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var title: String
    var content: String
    var project: ProjectRef?
    var madeBy: MadeBy?
    var updatedAt: String?
    var openComments: Int?
}

/// Documents: pinned row, Made by me / Claude filter, a blue dot on Claude's new ones.
struct DocumentsScreen: View {
    @State private var docs: [DocumentSummary] = []
    @State private var filter = "all"
    @State private var query = ""
    @State private var openDoc: String?
    @Namespace private var zoom

    private var shown: [DocumentSummary] {
        docs.filter {
            (filter == "all" || (filter == "claude") == ($0.madeBy?.isClaude ?? false))
                && (query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) || ($0.excerpt ?? "").localizedCaseInsensitiveContains(query))
        }
    }

    var body: some View {
        List {
            Section {
                Picker("", selection: $filter) {
                    Text("All").tag("all")
                    Text("Made by me").tag("luke")
                    Text("Made by Claude").tag("claude")
                }
                .pickerStyle(.segmented)
                .controlRow()
            }

            let pinned = shown.filter { $0.pinned == true }
            if !pinned.isEmpty, query.isEmpty {
                Section {
                    PinnedRow(items: pinned.map { .init(id: $0.id, title: $0.title, excerpt: $0.excerpt, project: $0.project, madeBy: $0.madeBy, unread: $0.isNew == true) }, zoom: zoom) { openDoc = $0 }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                } header: { SectionTitle(text: "Pinned") }
            }
            Section {
                if docs.isEmpty { EmptyNote(text: "No documents yet.", symbol: "doc.text").listRowBackground(Color.clear) }
                ForEach(shown.filter { $0.pinned != true || !query.isEmpty }) { d in
                    NavigationLink(value: MoreRoute.document(d.id)) { DocumentRow(doc: d) }
                        .cardRow()
                        .swipeActions {
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                docs.removeAll { $0.id == d.id }
                                Task { await Repo.change("delete_document", ["id": .string(d.id)]) }
                                Toasts.shared.show("Moved to Trash") {
                                    Task { await Repo.change("restore_from_trash", ["type": "document", "id": .string(d.id)]); await load() }
                                }
                            }
                        }
                        .swipeActions(edge: .leading) {
                            Button(d.pinned == true ? "Unpin" : "Pin", systemImage: d.pinned == true ? "pin.slash" : "pin") {
                                Task { await Repo.change("update_document", ["id": .string(d.id), "pinned": .bool(!(d.pinned ?? false))]); await load() }
                            }
                            .tint(Color.swipePrimary)
                        }
                }
            }
        }
        .listStyle(.insetGrouped)
        .pageBackground()
        .navigationTitle("Documents")
        .searchable(text: $query, prompt: "Search documents")
        .navigationDestination(item: $openDoc) { DocumentScreen(documentId: $0).zoomTransition($0, in: zoom) }
        .task { await load() }
        .refreshable { await load() }
        .onDisappear {
            if docs.contains(where: { $0.isNew == true }) {
                Task { await Repo.change("mark_from_claude_seen", [:]); await Home.shared.refresh() }
            }
        }
    }

    private func load() async {
        if let c = await Repo.cached("list_documents", as: [DocumentSummary].self) { docs = c }
        if let f = try? await Repo.fetch("list_documents", as: [DocumentSummary].self) { docs = f }
    }
}

struct DocumentRow: View {
    var doc: DocumentSummary
    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            HStack(spacing: Space.line) {
                if doc.isNew == true { UnreadDot() }
                Text(doc.title).textStyle(.control, medium: true, color: .ink).lineLimit(1)
                ClaudeMark(madeBy: doc.madeBy)
                Spacer(minLength: 4)
                if let n = doc.openComments, n > 0 {
                    Label("\(n)", systemImage: "bubble").labelStyle(.titleAndIcon).textStyle(.meta, color: .mutedText)
                }
                Text(Stamp.relative(doc.updatedAt)).textStyle(.meta, color: .mutedText)
            }
            if let ex = doc.excerpt, !ex.isEmpty {
                Text(ex).textStyle(.preview, color: .mutedText).lineLimit(2)
            }
        }
        .padding(.vertical, Space.xs)
    }
}

/// A document as a page: rendered Markdown, comments, Share as PDF, Edit on the web.
struct DocumentScreen: View {
    var documentId: String
    @State private var doc: LukeDocument?
    @State private var showComments = false
    @State private var showWeb = false
    @State private var pdf: URL?
    @State private var makingPDF = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.row) {
                if let doc {
                    HStack(spacing: Space.s) {
                        if let p = doc.project { ProjectChip(name: p.name, color: p.color) }
                        if doc.madeBy?.isClaude == true {
                            Label("By \(doc.madeBy?.name ?? "Claude")", systemImage: "sparkle").textStyle(.meta, color: .mutedText)
                        }
                        Spacer()
                        Text(Stamp.relative(doc.updatedAt)).textStyle(.meta, color: .mutedText)
                    }
                    // The first heading is the title on the page itself.
                    if !doc.content.hasPrefix("# ") {
                        Text(doc.title).textStyle(.title, medium: true, color: .ink)
                    }
                    MarkdownView(text: doc.content) { line in
                        self.doc?.content = Markdown.toggleCheck(doc.content, line: line)
                        if let c = self.doc?.content { Task { await Repo.change("update_document", ["id": .string(documentId), "content": .string(c)]) } }
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, Space.section * 2)
                }
            }
            .padding(.horizontal, Space.xxl)
            .padding(.vertical, Space.l)
            .background(Color.card, in: .rect(cornerRadius: Radius.card))
            .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Color.hairline, lineWidth: 1))
            .padding(.horizontal, Space.m)
            .padding(.bottom, Size.bottomClearance)
        }
        .pageBackground()
        .navigationBarTitleDisplayMode(.inline)
        .navigationTitle(doc?.title ?? "")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showComments = true } label: {
                    Image(systemName: (doc?.openComments ?? 0) > 0 ? "bubble.fill" : "bubble")
                }
                .accessibilityLabel("Comments")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Share as PDF", systemImage: "square.and.arrow.up") { Task { await makePDF() } }
                    Button("Edit on the web", systemImage: "safari") { showWeb = true }
                    if let doc { ShareLink(item: doc.content) { Label("Share text", systemImage: "doc.on.doc") } }
                } label: { if makingPDF { ProgressView() } else { Image(systemName: "ellipsis") } }
            }
        }
        .sheet(isPresented: $showComments) {
            NavigationStack {
                ScrollView { CommentThreads(targetType: "document", targetId: documentId).padding(Space.xl) }
                    .background(Color.page)
                    .navigationTitle("Comments")
                    .navigationBarTitleDisplayMode(.inline)
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showWeb, onDismiss: { Task { await load() } }) { WebSheet(path: "/documents/\(documentId)") }
        .sheet(item: $pdf) { url in ShareSheet(items: [url]) }
        .task { await load() }
    }

    private func load() async {
        if let c = await Repo.cached("get_document", ["id": .string(documentId)], as: LukeDocument.self) { doc = c }
        if let f = try? await Repo.fetch("get_document", ["id": .string(documentId)], as: LukeDocument.self) { doc = f }
    }

    private func makePDF() async {
        makingPDF = true
        defer { makingPDF = false }
        var req = LukeAPI.shared.request("api/documents/\(documentId)/pdf")
        req.httpMethod = "GET"
        guard !SharedConfig.isDemo, let data = try? await LukeAPI.shared.send(req) else {
            Toasts.shared.show("Couldn't make the PDF.")
            return
        }
        let name = (doc?.title ?? "Document").replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory.appending(path: "\(name).pdf")
        try? data.write(to: url)
        pdf = url
    }
}

extension URL: @retroactive Identifiable { public var id: String { absoluteString } }

/// The system share sheet.
struct ShareSheet: UIViewControllerRepresentable {
    var items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
