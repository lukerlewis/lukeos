import SwiftUI
import PhotosUI
import QuickLook
import Observation
import UniformTypeIdentifiers

struct Message: Codable, Hashable, Sendable, Identifiable {
    struct Attachment: Codable, Hashable, Sendable, Identifiable {
        var id: String
        var kind: String
        var name: String
        var mimeType: String?
        var bytes: Int?
        var url: String
        var thumb: String?
        var width: Double?
        var height: Double?
    }
    struct Link: Codable, Hashable, Sendable { var type: String; var id: String; var title: String? }
    struct Reply: Codable, Hashable, Sendable { var id: String; var from: String; var snippet: String?; var unavailable: Bool? }

    var id: String
    var text: String
    var attachments: [Attachment]
    var from: String
    var link: Link?
    var createdAt: String
    var read: Bool?
    var answered: Bool?
    var editedAt: String?
    var unsent: Bool?
    var replyTo: Reply?
    /// Shown while it's still on its way.
    var sending: Bool?

    var mine: Bool { from == "luke" }
}

struct MessagesAnswer: Codable, Sendable {
    var messages: [Message]
    var unread: Int
    var nextCheckIn: String?
}

@MainActor @Observable
final class MessagesModel {
    var messages: [Message] = []
    var nextCheckIn: String?
    var loaded = false

    func load() async {
        if !loaded, let c = await ResponseCache.shared.read("app-messages"), let a = try? LukeAPI.decoder.decode(MessagesAnswer.self, from: c) {
            apply(a)
        }
        do {
            let raw = try await LukeAPI.shared.getData("api/app/messages", query: [URLQueryItem(name: "limit", value: "200")])
            let a = try LukeAPI.decoder.decode(MessagesAnswer.self, from: raw)
            await ResponseCache.shared.write("app-messages", raw)
            apply(a)
        } catch APIError.signedOut {
            NotificationCenter.default.post(name: .lukeOSSignedOut, object: nil)
        } catch {}
        loaded = true
        Home.shared.markRead()
    }

    private func apply(_ a: MessagesAnswer) {
        let pending = messages.filter { $0.sending == true }
        messages = a.messages + pending.filter { p in !a.messages.contains { $0.id == p.id } }
        nextCheckIn = a.nextCheckIn
    }

    func send(text: String, attachments: [Message.Attachment], replyTo: Message?) {
        let local = Message(id: UUID().uuidString.lowercased(), text: text, attachments: attachments, from: "luke", createdAt: ISO8601DateFormatter.withFractional.string(from: .now),
                            replyTo: replyTo.map { Message.Reply(id: $0.id, from: $0.from, snippet: String($0.text.prefix(80))) }, sending: true)
        withAnimation(.snappy) { messages.append(local) }
        var input: Input = ["text": .string(text)]
        if let r = replyTo { input["replyTo"] = .string(r.id) }
        if !attachments.isEmpty {
            input["attachments"] = .array(attachments.map {
                .object(["fileId": .string($0.id), "thumbId": .optional($0.thumb.map { String($0.split(separator: "/").last ?? "") }),
                         "name": .string($0.name), "width": $0.width.map(JSON.number) ?? .null, "height": $0.height.map(JSON.number) ?? .null])
            })
        }
        Task {
            await Repo.change("send_message", input)
            await load()
        }
    }

    func edit(_ m: Message, text: String) {
        if let i = messages.firstIndex(of: m) { messages[i].text = text; messages[i].editedAt = ISO8601DateFormatter.withFractional.string(from: .now) }
        Task { await Repo.change("edit_message", ["id": .string(m.id), "text": .string(text)]) }
    }

    func unsend(_ m: Message) {
        if let i = messages.firstIndex(of: m) { withAnimation(.snappy) { messages[i].unsent = true; messages[i].text = ""; messages[i].attachments = [] } }
        Task { await Repo.change("unsend_message", ["id": .string(m.id)]) }
    }

    /// Uploads a picture or file (up to 4 MB) and returns it ready to attach.
    func upload(_ data: Data, name: String, type: String) async -> Message.Attachment? {
        guard data.count <= 4 * 1024 * 1024 else {
            Toasts.shared.show("Files over 4 MB can't be sent from the phone yet.")
            return nil
        }
        struct Uploaded: Decodable { var fileId: String; var thumbId: String?; var kind: String?; var name: String?; var mimeType: String?; var bytes: Int?; var width: Double?; var height: Double? }
        do {
            var req = LukeAPI.shared.request("api/messages/upload")
            if SharedConfig.isDemo { throw APIError.offline }
            req.httpMethod = "POST"
            req.setValue(type, forHTTPHeaderField: "content-type")
            req.setValue(name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed), forHTTPHeaderField: "x-file-name")
            req.httpBody = data
            req.timeoutInterval = 120
            let u = try LukeAPI.decoder.decode(Uploaded.self, from: try await LukeAPI.shared.send(req))
            return Message.Attachment(id: u.fileId, kind: u.kind ?? "file", name: u.name ?? name, mimeType: u.mimeType, bytes: u.bytes,
                                      url: "/api/stored/\(u.fileId)", thumb: u.thumbId.map { "/api/stored/\($0)" }, width: u.width, height: u.height)
        } catch {
            Toasts.shared.show(error.localizedDescription)
            return nil
        }
    }
}

/// The text conversation with Claude. Luke's bubbles are ink with light text, never blue.
struct MessagesScreen: View {
    @State private var model = MessagesModel()
    @State private var draft = ""
    @State private var replyingTo: Message?
    @State private var editing: Message?
    @State private var pending: [Message.Attachment] = []
    @State private var photos: [PhotosPickerItem] = []
    @State private var pickingPhotos = false
    @State private var pickingFile = false
    @State private var uploading = false
    @State private var viewing: Message.Attachment?
    @State private var preview: URL?
    @State private var notificationsAsked = true
    @FocusState private var focused: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 2) {
                    if !notificationsAsked { notificationBanner }
                    ForEach(Array(model.messages.enumerated()), id: \.element.id) { i, m in
                        if i == 0 || gap(model.messages[i - 1], m) {
                            Text(stamp(m.createdAt)).textStyle(.tag, medium: true, color: .mutedText)
                                .padding(.top, 14).padding(.bottom, 6)
                        }
                        MessageBubble(message: m, grouped: i > 0 && model.messages[i - 1].from == m.from && !gap(model.messages[i - 1], m),
                                      onAttachment: open, onReplyTap: { id in withAnimation { proxy.scrollTo(id, anchor: .center) } })
                            .id(m.id)
                            .contextMenu { menu(m) }
                        if m.id == lastUnanswered?.id {
                            Text(deliveredLine).textStyle(.tag, color: .mutedText)
                                .frame(maxWidth: .infinity, alignment: .trailing)
                                .padding(.trailing, 6).padding(.top, 2)
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: model.messages.count) { _, _ in
                if let last = model.messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
            }
        }
        .background(Color.card.ignoresSafeArea())
        .safeAreaInset(edge: .bottom) { composer }
        .navigationTitle("Claude")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await model.load()
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            notificationsAsked = SharedConfig.isDemo || settings.authorizationStatus != .notDetermined
        }
        .refreshable { await model.load() }
        .photosPicker(isPresented: $pickingPhotos, selection: $photos, maxSelectionCount: 4, matching: .any(of: [.images, .videos]))
        .onChange(of: photos) { _, items in Task { await addPhotos(items) } }
        .fileImporter(isPresented: $pickingFile, allowedContentTypes: [.item]) { result in
            if case .success(let url) = result { Task { await addFile(url) } }
        }
        .fullScreenCover(item: $viewing) { a in PhotoViewer(attachment: a) }
        .quickLookPreview($preview)
        .onReceive(NotificationCenter.default.publisher(for: .lukeOSPushArrived)) { _ in Task { await model.load() } }
    }

    // MARK: Pieces

    private var lastUnanswered: Message? {
        guard let last = model.messages.last(where: { $0.unsent != true }), last.mine, last.answered != true else { return nil }
        return last
    }

    private var deliveredLine: String {
        guard let next = Stamp.date(model.nextCheckIn) else { return "Delivered" }
        let time = next.formatted(.dateTime.hour().minute()).lowercased().replacingOccurrences(of: ":00", with: "").replacingOccurrences(of: " ", with: "")
        let day = Calendar.current.isDateInToday(next) ? "" : Calendar.current.isDateInTomorrow(next) ? " tomorrow" : " " + next.formatted(.dateTime.weekday(.wide))
        return "Delivered · Claude reads it at \(time)\(day)"
    }

    private var notificationBanner: some View {
        HStack(spacing: 12) {
            Image(systemName: "bell.badge").foregroundStyle(Color.ink)
            Text("Get a notification when Claude replies.").textStyle(.preview, color: .text)
            Spacer()
            Button("Turn on") {
                Task {
                    await Push.registerIfAllowed(ask: true)
                    notificationsAsked = true
                }
            }
            .font(.geist(.preview, medium: true))
            .buttonStyle(.bordered).tint(.ink)
        }
        .padding(14)
        .background(Color.raised, in: .rect(cornerRadius: Radius.container))
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private func menu(_ m: Message) -> some View {
        if m.unsent != true {
            Button("Reply", systemImage: "arrowshape.turn.up.left") { replyingTo = m; focused = true }
            if !m.text.isEmpty { Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = m.text } }
            if m.mine {
                if !m.text.isEmpty {
                    Button("Edit", systemImage: "pencil") { editing = m; draft = m.text; focused = true }
                }
                Button("Unsend", systemImage: "arrow.uturn.backward", role: .destructive) { model.unsend(m) }
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 8) {
            if let r = replyingTo ?? editing {
                HStack(spacing: 8) {
                    Rectangle().fill(Color.strokeStrong).frame(width: 2, height: 28)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(editing != nil ? "Editing" : "Replying to \(r.mine ? "yourself" : "Claude")").textStyle(.tag, medium: true, color: .mutedText)
                        Text(r.text.isEmpty ? "Attachment" : r.text).textStyle(.meta, color: .subtleText).lineLimit(1)
                    }
                    Spacer()
                    Button { replyingTo = nil; if editing != nil { editing = nil; draft = "" } } label: { Image(systemName: "xmark.circle.fill") }
                        .foregroundStyle(Color.icon)
                        .accessibilityLabel("Cancel")
                }
                .padding(.horizontal, 8)
            }
            if !pending.isEmpty || uploading {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(pending) { a in
                            ZStack(alignment: .topTrailing) {
                                if a.kind == "image" {
                                    RemoteImage(path: a.thumb ?? a.url, contentMode: .fill).frame(width: 64, height: 64).clipShape(.rect(cornerRadius: 12))
                                } else {
                                    FileChip(name: a.name).frame(height: 64)
                                }
                                Button { pending.removeAll { $0.id == a.id } } label: {
                                    Image(systemName: "xmark.circle.fill").symbolRenderingMode(.palette).foregroundStyle(Color.onSolid, Color.ink)
                                }
                                .offset(x: 6, y: -6)
                            }
                        }
                        if uploading { ProgressView().frame(width: 64, height: 64) }
                    }
                    .padding(.horizontal, 8).padding(.top, 6)
                }
                .scrollIndicators(.hidden)
            }
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    Button("Photos", systemImage: "photo.on.rectangle") { pickingPhotos = true }
                    Button("Files", systemImage: "folder") { pickingFile = true }
                } label: {
                    Image(systemName: "plus").font(.system(size: 18)).frame(width: 40, height: 40)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .foregroundStyle(Color.ink)
                .accessibilityLabel("Add")

                HStack(alignment: .bottom) {
                    TextField(editing != nil ? "Edit message" : "Message", text: $draft, axis: .vertical)
                        .font(.geist(.body))
                        .lineLimit(1...6)
                        .focused($focused)
                        .padding(.vertical, 9)
                        .padding(.leading, 14)
                    if canSend {
                        Button(action: send) {
                            Image(systemName: "arrow.up").font(.system(size: 15, weight: .medium))
                                .foregroundStyle(Color.onSolid)
                                .frame(width: 30, height: 30)
                                .background(Color.ink, in: .circle)
                        }
                        .padding(5)
                        .transition(.scale.combined(with: .opacity))
                        .accessibilityLabel("Send")
                    }
                }
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 20))
                .animation(.snappy, value: canSend)
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private var canSend: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !pending.isEmpty }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if let m = editing {
            if !text.isEmpty { model.edit(m, text: text) }
            editing = nil
        } else {
            model.send(text: text, attachments: pending, replyTo: replyingTo)
        }
        draft = ""
        pending = []
        replyingTo = nil
        Haptics.tap()
    }

    private func gap(_ a: Message, _ b: Message) -> Bool {
        guard let da = Stamp.date(a.createdAt), let db = Stamp.date(b.createdAt) else { return false }
        return db.timeIntervalSince(da) > 3600
    }

    private func stamp(_ s: String) -> String {
        guard let d = Stamp.date(s) else { return "" }
        if Calendar.current.isDateInToday(d) { return "Today " + d.formatted(date: .omitted, time: .shortened) }
        if Calendar.current.isDateInYesterday(d) { return "Yesterday " + d.formatted(date: .omitted, time: .shortened) }
        return d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute())
    }

    private func open(_ a: Message.Attachment) {
        if a.kind == "image" { viewing = a; return }
        Task {
            if SharedConfig.isDemo, let local = await DemoServer.shared.localFile(a.url) { preview = local; return }
            var req = LukeAPI.shared.request(String(a.url.dropFirst()))
            req.httpMethod = "GET"
            guard let data = try? await LukeAPI.shared.send(req) else { Toasts.shared.show("Couldn't open it."); return }
            let file = FileManager.default.temporaryDirectory.appending(path: a.name)
            try? data.write(to: file)
            preview = file
        }
    }

    private func addPhotos(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        photos = []
        uploading = true
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self) {
                if let image = UIImage(data: data), let jpeg = image.shrunk(to: 2000).jpegData(compressionQuality: 0.85) {
                    if let a = await model.upload(jpeg, name: "Photo.jpg", type: "image/jpeg") { pending.append(a) }
                } else if let a = await model.upload(data, name: "Video.mov", type: "video/quicktime") {
                    pending.append(a)
                }
            }
        }
        uploading = false
    }

    private func addFile(_ url: URL) async {
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        uploading = true
        let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        if let a = await model.upload(data, name: url.lastPathComponent, type: type) { pending.append(a) }
        uploading = false
    }
}

extension Notification.Name {
    static let lukeOSPushArrived = Notification.Name("lukeOSPushArrived")
}

/// One message: a quoted reply above it, its text, pictures, files and link card.
struct MessageBubble: View {
    var message: Message
    var grouped: Bool
    var onAttachment: (Message.Attachment) -> Void
    var onReplyTap: (String) -> Void
    @Environment(AppModel.self) private var app

    var body: some View {
        let mine = message.mine
        VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
            if message.unsent == true {
                Text(mine ? "You unsent a message" : "Claude unsent a message")
                    .textStyle(.meta, color: .mutedText).italic()
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity)
            } else {
                if let r = message.replyTo {
                    Button { onReplyTap(r.id) } label: {
                        Text(r.unavailable == true ? "Original message unavailable" : (r.snippet ?? ""))
                            .textStyle(.meta, color: .mutedText)
                            .lineLimit(2)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.stroke, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 6)
                }
                ForEach(message.attachments) { a in
                    if a.kind == "image" {
                        Button { onAttachment(a) } label: {
                            RemoteImage(path: a.thumb ?? a.url, contentMode: .fill)
                                .frame(width: 220, height: 220 * CGFloat((a.height ?? 3) / max(a.width ?? 4, 1)))
                                .clipShape(.rect(cornerRadius: 18))
                        }
                        .buttonStyle(.plain)
                    } else {
                        Button { onAttachment(a) } label: { FileChip(name: a.name, bytes: a.bytes) }.buttonStyle(.plain)
                    }
                }
                if !message.text.isEmpty {
                    Text(Markdown.inline(message.text))
                        .font(.geist(.body))
                        .foregroundStyle(mine ? Color.onSolid : Color.text)
                        .tint(mine ? Color.onSolid : Color.ink)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(mine ? Color.ink : Color.muted, in: .rect(cornerRadius: 20))
                        .opacity(message.sending == true ? 0.6 : 1)
                        .textSelection(.enabled)
                }
                if let link = message.link {
                    Button { app.open(path(link)) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: symbol(link.type)).foregroundStyle(Color.icon).frame(width: 22)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(link.title ?? link.type.capitalized).textStyle(.preview, medium: true, color: .ink).lineLimit(1)
                                Text(link.type.capitalized).textStyle(.tag, color: .mutedText)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(Color.icon)
                        }
                        .padding(12)
                        .frame(width: 240)
                        .background(Color.card, in: .rect(cornerRadius: 16))
                        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.stroke, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
                if message.editedAt != nil {
                    Text("Edited").textStyle(.tag, color: .mutedText).padding(.horizontal, 6)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .padding(mine ? .leading : .trailing, 54)
        .padding(.top, grouped ? 0 : 6)
    }

    private func path(_ l: Message.Link) -> String {
        switch l.type {
        case "task": "/?task=\(l.id)"
        case "note": "/notes/\(l.id)"
        case "document": "/documents/\(l.id)"
        case "project": "/projects/\(l.id)"
        case "inspiration": "/inspiration/\(l.id)"
        case "entry": "/archive/\(l.id)"
        default: "/\(l.type)s/\(l.id)"
        }
    }

    private func symbol(_ type: String) -> String {
        switch type {
        case "task": "checkmark.circle"
        case "note": "note.text"
        case "document": "doc.text"
        case "project": "folder"
        case "inspiration": "lightbulb"
        default: "link"
        }
    }
}

/// A file as a small card: icon, name, size.
struct FileChip: View {
    var name: String
    var bytes: Int?
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: name.lowercased().hasSuffix(".pdf") ? "doc.richtext" : "doc").font(.system(size: 20)).foregroundStyle(Color.icon)
            VStack(alignment: .leading, spacing: 1) {
                Text(name).textStyle(.preview, medium: true, color: .ink).lineLimit(1)
                if let bytes { Text(ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)).textStyle(.tag, color: .mutedText) }
            }
        }
        .padding(12)
        .frame(maxWidth: 240, alignment: .leading)
        .background(Color.card, in: .rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.stroke, lineWidth: 1))
    }
}

/// A picture full screen: pinch to zoom, swipe down or tap Done to close.
struct PhotoViewer: View {
    var attachment: Message.Attachment
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1
    @State private var image: UIImage?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                RemoteImage(path: attachment.url)
                    .scaleEffect(scale)
                    .gesture(MagnifyGesture().onChanged { scale = max(1, $0.magnification) }.onEnded { _ in withAnimation { scale = 1 } })
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button(role: .close) { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    if let image { ShareLink(item: Image(uiImage: image), preview: SharePreview(attachment.name, image: Image(uiImage: image))) }
                }
            }
            .task { image = await ImageStore.shared.image(attachment.url) }
        }
        .gesture(DragGesture().onEnded { if $0.translation.height > 120 { dismiss() } })
    }
}
