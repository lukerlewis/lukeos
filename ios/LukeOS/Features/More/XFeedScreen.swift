import SwiftUI

struct XPersonRef: Codable, Hashable, Sendable {
    var id: String
    var handle: String
    var name: String?
    var company: String?
    var avatarUrl: String?
    /// Following them on X: pending until Claude does it at the next check-in.
    var follow: XActionState?
    var display: String { name?.isEmpty == false ? name! : handle }
}

/// Follow taps made in the app, by person, so every post of theirs shows the same state at once.
/// A tap counts only until the server's copy changes (then the server knows better).
@MainActor @Observable
final class XFollowTaps {
    static let shared = XFollowTaps()
    private var taps: [String: (state: XActionState, base: XActionState?)] = [:]

    func state(for person: XPersonRef) -> XActionState {
        if let tap = taps[person.id], tap.base == person.follow { return tap.state }
        return person.follow ?? XActionState(on: false, pending: false)
    }

    func set(_ person: XPersonRef, _ state: XActionState) {
        taps[person.id] = (state, person.follow)
    }
}

struct XPerson: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var handle: String
    var name: String?
    var company: String?
    var avatarUrl: String?
    var url: String
    var checkedAt: String?
    var display: String { name?.isEmpty == false ? name! : "@\(handle)" }
}

struct XReply: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var postId: String
    var text: String
    /// draft (written by Claude, waits for Luke), queued, sent, failed.
    var status: String
    var error: String?
    var replyUrl: String?
    var madeBy: MadeBy?
}

struct XContext: Codable, Hashable, Sendable {
    var author: String?
    var text: String?
    var url: String?
}

struct XPost: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var url: String
    var text: String
    var kind: String
    var context: XContext?
    var media: [String]
    var postedAt: String
    var isNew: Bool
    var person: XPersonRef
    var replies: [XReply]
    var actions: [String: XActionState]?
}

/// A like, repost or bookmark: on is what Luke wants; pending until Claude does it on X at the next check-in.
struct XActionState: Codable, Hashable, Sendable {
    var on: Bool
    var pending: Bool
    var error: String?
    /// What it is on X now.
    var done: Bool?
}

struct XFeed: Codable, Hashable, Sendable {
    var people: [XPerson]
    var posts: [XPost]
    var more: String?
    var checkedAt: String?
    var companies: [String]?
}

/// X feed: posts from the people Luke picks on X, and his replies to them.
/// Claude posts the replies on X at the next check-in, exactly as he wrote them.
struct XFeedScreen: View {
    @State private var feed: XFeed?
    @State private var view: String?
    @State private var company: String?
    @State private var person: String?
    @State private var composing: Composer?
    @State private var showingPeople = false
    @State private var sawNew = false
    @State private var loadingMore = false

    struct Composer: Identifiable {
        var id: String { reply?.id ?? post.id }
        var post: XPost
        var reply: XReply?
    }

    /// The filters at the top: day (last 24 hours), unreplied, replied, pictures.
    private static let views: [(id: String?, label: String)] = [
        (nil, "All"), ("day", "Last 24 hours"), ("unreplied", "Not replied"), ("replied", "Replied"), ("pictures", "With pictures"),
    ]

    private var input: Input {
        var i: Input = [:]
        if let view { i["view"] = .string(view) }
        if let company { i["company"] = .string(company) }
        if let person { i["personId"] = .string(person) }
        return i
    }

    private var filtered: Bool { view != nil || company != nil || person != nil }

    var body: some View {
        List {
            if let feed, !feed.people.isEmpty {
                Section {
                    chips {
                        ForEach(Self.views, id: \.label) { v in
                            ChipToggle(label: v.label, on: view == v.id) { pick { view = v.id } }
                        }
                    }
                    .controlRow()
                    let companies = feed.companies ?? []
                    let picked = person.flatMap { id in feed.people.first { $0.id == id } }
                    if companies.count > 1 || picked != nil {
                        chips {
                            if let picked {
                                ChipToggle(label: "\(picked.display)  ✕", on: true) { pick { person = nil } }
                            }
                            ForEach(companies, id: \.self) { c in
                                ChipToggle(label: c, on: company == c) { pick { company = company == c ? nil : c } }
                            }
                        }
                        .controlRow()
                    }
                } footer: {
                    if let at = feed.checkedAt { Text("Checked \(Stamp.relative(at))").textStyle(.meta, color: .mutedText).padding(.horizontal, Space.xl) }
                }
            }
            if let feed {
                if feed.people.isEmpty {
                    EmptyNote(text: "Add people to follow.", symbol: "at").listRowBackground(Color.clear)
                } else if feed.posts.isEmpty {
                    EmptyNote(text: filtered ? "No posts here." : "No posts yet.", symbol: "at").listRowBackground(Color.clear)
                }
                // Each post is its own card.
                ForEach(feed.posts) { post in
                    Section {
                        XPostRow(post: post, onReply: { composing = Composer(post: post) },
                                 onEdit: { composing = Composer(post: post, reply: $0) },
                                 onChanged: { Task { await load() } })
                            .cardRow()
                            .contextMenu {
                                Button("Reply", systemImage: "bubble.left") { composing = Composer(post: post) }
                                if let url = URL(string: post.url) { Link(destination: url) { Label("Open on X", systemImage: "arrow.up.right.square") } }
                                Button("Only \(post.person.display)", systemImage: "line.3.horizontal.decrease") { pick { person = post.person.id } }
                                Button("Remove from feed", systemImage: "trash", role: .destructive) { remove(post) }
                            }
                    }
                    .listSectionSpacing(Space.m)
                }
                if feed.more != nil {
                    Section {
                        Button { Task { await loadMore() } } label: {
                            Text("Older posts").textStyle(.control, color: .subtleText).frame(maxWidth: .infinity)
                        }
                        .disabled(loadingMore)
                        .cardRow()
                    }
                }
            } else {
                DelayedSpinner().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .pageBackground()
        .navigationTitle("X feed")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingPeople = true } label: { Image(systemName: "person.2") }
                    .accessibilityLabel("People")
            }
        }
        .sheet(item: $composing) { c in
            XReplySheet(post: c.post, reply: c.reply) { Task { await load() } }
        }
        .sheet(isPresented: $showingPeople, onDismiss: { Task { await load() } }) {
            XPeopleSheet(people: feed?.people ?? [])
        }
        .task { await load(cachedFirst: true) }
        .refreshable { await load() }
        .onDisappear {
            if sawNew { Task { await Repo.change("mark_x_feed_seen", [:]) } }
        }
    }

    /// A sideways-scrolling row of chips, edge to edge.
    private func chips<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: Space.s) { content() }
                .padding(.horizontal, Space.xl)
        }
        .scrollIndicators(.hidden)
    }

    private func pick(_ change: () -> Void) {
        change()
        feed?.posts = []
        feed?.more = nil
        Task { await load(cachedFirst: true) }
    }

    private func load(cachedFirst: Bool = false) async {
        if cachedFirst, let c = await Repo.cached("get_x_feed", input, as: XFeed.self) { feed = c }
        if let f = try? await Repo.fetch("get_x_feed", input, as: XFeed.self) {
            feed = f
            if f.posts.contains(where: \.isNew) { sawNew = true }
        }
    }

    private func loadMore() async {
        guard let before = feed?.more else { return }
        loadingMore = true
        defer { loadingMore = false }
        var more = input
        more["before"] = .string(before)
        if let f = try? await Repo.fetch("get_x_feed", more, as: XFeed.self) {
            feed?.posts += f.posts
            feed?.more = f.more
        }
    }

    private func remove(_ post: XPost) {
        withAnimation(Motion.snappy) { feed?.posts.removeAll { $0.id == post.id } }
        Task { await Repo.change("delete_x_post", ["id": .string(post.id)]) }
    }
}

/// One post: who, when, the text, pictures, a quoted post, then Luke's replies and a Reply button.
struct XPostRow: View {
    var post: XPost
    var onReply: () -> Void
    var onEdit: (XReply) -> Void
    var onChanged: () -> Void
    @State private var viewing: Int?
    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(alignment: .top, spacing: Space.m) {
            XAvatar(url: post.person.avatarUrl, name: post.person.display)
            VStack(alignment: .leading, spacing: Space.s) {
                HStack(spacing: Space.xs) {
                    Text(post.person.display).textStyle(.meta, medium: true, color: .ink).lineLimit(1)
                        .layoutPriority(2)
                    if let company = post.person.company, !company.isEmpty {
                        Tag(company).fixedSize().layoutPriority(3)
                    }
                    // The @username shows only when it fits whole; otherwise it drops out instead of becoming a sliver.
                    ViewThatFits(in: .horizontal) {
                        Text("@\(post.person.handle)").textStyle(.meta, color: .mutedText).lineLimit(1).fixedSize()
                        Color.clear.frame(width: 0, height: 0)
                    }
                    Text("· \(Stamp.relative(post.postedAt))").textStyle(.meta, color: .mutedText).lineLimit(1)
                        .fixedSize().layoutPriority(3)
                    Spacer(minLength: 0)
                    if post.isNew { UnreadDot() }
                }
                if !post.text.isEmpty {
                    Text(linked(post.text)).textStyle(.body, color: .subtleText)
                        .tint(Color.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !post.media.isEmpty {
                    XMediaGrid(urls: post.media) { i in viewing = i } onVideo: {
                        if let url = URL(string: post.url) { openURL(url) }
                    }
                }
                if post.kind == "quote", let q = post.context, q.text != nil || q.author != nil {
                    VStack(alignment: .leading, spacing: Space.xs) {
                        if let a = q.author { Label(a, systemImage: "arrow.2.squarepath").textStyle(.meta, medium: true, color: .text) }
                        if let t = q.text { Text(t).textStyle(.preview, color: .subtleText).lineLimit(6) }
                    }
                    .padding(Space.m)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Color.stroke, lineWidth: 1))
                }
                ForEach(post.replies) { r in
                    XReplyBox(reply: r, onEdit: { onEdit(r) }, onChanged: onChanged)
                }
                XActionBar(post: post, onReply: onReply)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .fullScreenCover(item: Binding(get: { viewing.map { XPhotoStart(index: $0) } }, set: { viewing = $0?.index })) { start in
            XPhotoViewer(photos: post.media.filter { !XMedia.isVideo($0) }, start: start.index, postURL: post.url)
        }
    }

    /// Web addresses and @names as links.
    private func linked(_ text: String) -> AttributedString {
        var out = AttributedString(text)
        let pattern = #/(https?:\/\/[^\s]+)|(@[A-Za-z0-9_]{1,15})/#
        for match in text.matches(of: pattern) {
            let word = String(text[match.range])
            guard let range = out.range(of: word) else { continue }
            let url = word.hasPrefix("@") ? URL(string: "https://x.com/\(word.dropFirst())") : URL(string: word)
            out[range].link = url
            out[range].foregroundColor = Color.ink
        }
        return out
    }
}

/// A profile picture from X, or the first letter while it loads.
struct XAvatar: View {
    var url: String?
    var name: String
    var body: some View {
        ZStack {
            Circle().fill(Color.muted)
            Text(String(name.prefix(1)).uppercased()).textStyle(.control, medium: true, color: .mutedText)
            if let url { RemoteImage(path: url, contentMode: .fill).clipShape(.circle) }
        }
        .frame(width: 40, height: 40)
        .accessibilityHidden(true)
    }
}

/// A reply under its post, with where it's up to.
struct XReplyBox: View {
    var reply: XReply
    var onEdit: () -> Void
    var onChanged: () -> Void

    private var status: (symbol: String, label: String) {
        switch reply.status {
        case "draft": ("sparkle", "Draft by Claude")
        case "sent": ("checkmark", "Posted")
        case "failed": ("exclamationmark.triangle", "Couldn't post")
        default: ("clock", "Waiting to post")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Text(reply.text).textStyle(.preview, color: .text).fixedSize(horizontal: false, vertical: true)
            if reply.status == "failed", let e = reply.error { Text(e).textStyle(.meta, color: .notification) }
            HStack(spacing: Space.s) {
                if reply.status == "sent", let u = reply.replyUrl, let url = URL(string: u) {
                    Link(destination: url) { Label(status.label, systemImage: status.symbol) }
                        .textStyle(.meta, color: .mutedText)
                } else {
                    Label(status.label, systemImage: status.symbol).textStyle(.meta, color: .mutedText)
                }
                Spacer(minLength: 0)
                if reply.status != "sent" {
                    Menu {
                        Button("Edit", systemImage: "pencil", action: onEdit)
                        Button("Cancel reply", systemImage: "trash", role: .destructive) {
                            Task { await Repo.change("delete_x_reply", ["id": .string(reply.id)]); onChanged() }
                        }
                    } label: {
                        Image(systemName: "ellipsis").font(.icon(.row)).foregroundStyle(Color.icon).frame(width: Size.tap, height: Size.tap)
                    }
                    .accessibilityLabel("Reply options")
                }
                if reply.status == "draft" || reply.status == "failed" {
                    Button(reply.status == "failed" ? "Try again" : "Send") {
                        Haptics.success()
                        Task {
                            await Repo.change("update_x_reply", ["id": .string(reply.id), "send": true])
                            Toasts.shared.show("Posts at the next check-in")
                            onChanged()
                        }
                    }
                    .font(.geist(.meta, medium: true))
                    .buttonStyle(.borderedProminent)
                    .tint(Color.ink)
                }
            }
        }
        .padding(Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.raised, in: .rect(cornerRadius: Radius.card))
    }
}

/// Writing a reply, or changing one that hasn't gone out yet.
struct XReplySheet: View {
    var post: XPost
    var reply: XReply?
    var onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var focused: Bool

    /// X's limit for accounts without Premium.
    private let limit = 280
    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Space.l) {
                Text(post.text.isEmpty ? "@\(post.person.handle)" : post.text)
                    .textStyle(.preview, color: .mutedText)
                    .lineLimit(3)
                TextEditor(text: $text)
                    .font(.geist(.body))
                    .scrollContentBackground(.hidden)
                    .focused($focused)
                    .frame(maxHeight: .infinity)
                if trimmed.count > limit - 40 {
                    Text("\(limit - trimmed.count)").textStyle(.meta, color: trimmed.count > limit ? .notification : .mutedText)
                        .monospacedDigit()
                }
            }
            .padding(.horizontal, Space.xl)
            .padding(.top, Space.s)
            .background(Color.card)
            .navigationTitle(reply == nil ? "Reply to \(post.person.display)" : "Edit reply")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", role: .cancel) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(reply == nil ? "Reply" : "Save") { save() }
                        .disabled(trimmed.isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear {
            text = reply?.text ?? ""
            focused = true
        }
    }

    private func save() {
        let words = trimmed
        dismiss()
        Task {
            if let reply {
                if words != reply.text { await Repo.change("update_x_reply", ["id": .string(reply.id), "text": .string(words)]) }
            } else {
                await Repo.change("write_x_reply", ["postId": .string(post.id), "text": .string(words)])
                Haptics.success()
                Toasts.shared.show("Posts at the next check-in")
            }
            onDone()
        }
    }
}

/// The people in the feed: add someone by their X username, swipe to take them out.
struct XPeopleSheet: View {
    @State var people: [XPerson]
    @Environment(\.dismiss) private var dismiss
    @State private var handle = ""
    @State private var company = ""
    @State private var adding = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("@username", text: $handle)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .font(.geist(.control))
                        .cardRow()
                    HStack(spacing: Space.m) {
                        TextField("Company", text: $company)
                            .submitLabel(.done)
                            .onSubmit(add)
                            .font(.geist(.control))
                        Button("Add", action: add).disabled(handle.trimmingCharacters(in: .whitespaces).isEmpty || adding)
                    }
                    .cardRow()
                } footer: {
                    if let error { Text(error).textStyle(.meta, color: .notification) }
                }
                Section {
                    ForEach($people) { $p in
                        HStack(spacing: Space.m) {
                            XAvatar(url: p.avatarUrl, name: p.name ?? p.handle)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.display).textStyle(.control, color: .text).lineLimit(1)
                                if p.name?.isEmpty == false { Text("@\(p.handle)").textStyle(.meta, color: .mutedText).lineLimit(1) }
                            }
                            Spacer(minLength: Space.s)
                            TextField("Company", text: Binding($p.company, replacingNilWith: ""))
                                .multilineTextAlignment(.trailing)
                                .font(.geist(.control))
                                .foregroundStyle(Color.subtleText)
                                .frame(maxWidth: 120)
                                .submitLabel(.done)
                                .onSubmit { saveCompany(p) }
                        }
                        .cardRow()
                        .swipeActions {
                            Button("Remove", systemImage: "trash", role: .destructive) {
                                people.removeAll { $0.id == p.id }
                                Task { await Repo.change("unfollow_x_person", ["id": .string(p.id)]) }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .pageBackground()
            .navigationTitle("People")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func saveCompany(_ p: XPerson) {
        let c = (p.company ?? "").trimmingCharacters(in: .whitespaces)
        Task { await Repo.change("update_x_person", ["id": .string(p.id), "company": c.isEmpty ? .null : .string(c)]) }
    }

    private func add() {
        let h = handle.trimmingCharacters(in: .whitespaces)
        guard !h.isEmpty else { return }
        adding = true
        error = nil
        Task {
            defer { adding = false }
            do {
                var input: Input = ["handle": .string(h)]
                let c = company.trimmingCharacters(in: .whitespaces)
                if !c.isEmpty { input["company"] = .string(c) }
                let p = try await Repo.create("follow_x_person", input, as: XPerson.self)
                if !people.contains(where: { $0.id == p.id }) { people.insert(p, at: 0) }
                handle = ""
                company = ""
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

extension Binding where Value == String {
    /// A text field for an optional string: empty text stands for nil.
    init(_ source: Binding<String?>, replacingNilWith empty: String) {
        self.init(get: { source.wrappedValue ?? empty }, set: { source.wrappedValue = $0.isEmpty ? nil : $0 })
    }
}

enum XMedia {
    /// X keeps video and GIF thumbnails under these folders.
    static func isVideo(_ url: String) -> Bool {
        ["/ext_tw_video_thumb/", "/amplify_video_thumb/", "/tweet_video_thumb/"].contains { url.contains($0) }
    }

    /// The biggest copy X has of a picture.
    static func large(_ url: String) -> String {
        url.replacingOccurrences(of: #"name=\w+"#, with: "name=large", options: .regularExpression)
    }
}

struct XPhotoStart: Identifiable { var index: Int; var id: Int { index } }

/// A post's pictures and video thumbnails. Pictures open full screen; videos open on X, where they play.
struct XMediaGrid: View {
    var urls: [String]
    var onPhoto: (Int) -> Void
    var onVideo: () -> Void

    var body: some View {
        let rows = stride(from: 0, to: urls.count, by: 2).map { Array(urls[$0 ..< min($0 + 2, urls.count)]) }
        VStack(spacing: 2) {
            ForEach(rows.indices, id: \.self) { r in
                HStack(spacing: 2) {
                    ForEach(rows[r], id: \.self) { url in cell(url, height: urls.count == 1 ? 220 : 140) }
                }
            }
        }
        .clipShape(.rect(cornerRadius: Radius.card))
        .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Color.hairline, lineWidth: 1))
    }

    private func cell(_ url: String, height: CGFloat) -> some View {
        let video = XMedia.isVideo(url)
        return Button {
            if video { onVideo() } else if let i = urls.filter({ !XMedia.isVideo($0) }).firstIndex(of: url) { onPhoto(i) }
        } label: {
            // The picture fills a fixed box so a wide one can't push the card past the screen edge.
            Color.muted
                .frame(maxWidth: .infinity)
                .frame(height: height)
                .overlay { RemoteImage(path: url, contentMode: .fill) }
                .overlay {
                    if video {
                        Image(systemName: "play.fill").font(.system(size: 22)).foregroundStyle(.white)
                            .frame(width: 56, height: 56)
                            .background(.black.opacity(0.6), in: .circle)
                    }
                }
                .clipped()
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(video ? "Play video on X" : "View picture")
    }
}

/// A post's pictures full screen: swipe between them, pinch to zoom, swipe down or Close to leave.
struct XPhotoViewer: View {
    var photos: [String]
    @State var start: Int
    var postURL: String
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                TabView(selection: $start) {
                    ForEach(photos.indices, id: \.self) { i in
                        RemoteImage(path: XMedia.large(photos[i]))
                            .scaleEffect(i == start ? scale : 1)
                            .gesture(MagnifyGesture().onChanged { scale = max(1, $0.magnification) }.onEnded { _ in withAnimation { scale = 1 } })
                            .tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: photos.count > 1 ? .always : .never))
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button(role: .close) { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    if let url = URL(string: postURL) {
                        Link(destination: url) { Image(systemName: "arrow.up.right.square") }
                            .accessibilityLabel("Open on X")
                    }
                }
            }
        }
        .gesture(DragGesture().onEnded { if $0.translation.height > 120 { dismiss() } })
    }
}

/// Reply, repost, like, bookmark and follow under a post. Claude does all but Reply on X at the next check-in.
struct XActionBar: View {
    var post: XPost
    var onReply: () -> Void
    @State private var state: [String: XActionState] = [:]

    private static let kinds: [(kind: String, off: String, on: String, label: String)] = [
        ("repost", "arrow.2.squarepath", "arrow.2.squarepath", "Repost"),
        ("like", "heart", "heart.fill", "Like"),
        ("bookmark", "bookmark", "bookmark.fill", "Bookmark"),
    ]

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onReply) {
                Label("Reply", systemImage: "bubble.left").textStyle(.meta, color: .subtleText)
                    .frame(minHeight: Size.tap)
                    .padding(.trailing, Space.m)
            }
            .buttonStyle(.borderless)
            ForEach(Self.kinds, id: \.kind) { k in
                let a = state[k.kind] ?? post.actions?[k.kind] ?? XActionState(on: false, pending: false)
                Button { toggle(k.kind, a) } label: {
                    Image(systemName: a.on ? k.on : k.off)
                        .font(.icon(.row))
                        .foregroundStyle(a.on ? Color.ink : Color.icon)
                        .opacity(a.pending ? 0.55 : 1)
                        .frame(width: Size.tap, height: Size.tap)
                        .overlay(alignment: .topTrailing) {
                            if a.error != nil {
                                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 9)).foregroundStyle(Color.notification).padding(8)
                            } else if a.pending {
                                Image(systemName: "clock").font(.system(size: 9)).foregroundStyle(Color.mutedText).padding(8)
                            }
                        }
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(a.on ? "\(k.label), on" : k.label)
                .accessibilityHint(a.pending ? "Happens on X at the next check-in" : "")
            }
            let f = XFollowTaps.shared.state(for: post.person)
            Button { toggleFollow(f) } label: {
                Image(systemName: f.on ? "person.crop.circle.badge.checkmark" : "person.crop.circle.badge.plus")
                    .font(.icon(.row))
                    .foregroundStyle(f.on ? Color.ink : Color.icon)
                    .opacity(f.pending ? 0.55 : 1)
                    .frame(width: Size.tap, height: Size.tap)
                    .overlay(alignment: .topTrailing) {
                        if f.error != nil {
                            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 9)).foregroundStyle(Color.notification).padding(8)
                        } else if f.pending {
                            Image(systemName: "clock").font(.system(size: 9)).foregroundStyle(Color.mutedText).padding(8)
                        }
                    }
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(f.on ? "Following \(post.person.display)" : "Follow \(post.person.display)")
            .accessibilityHint(f.pending ? "Happens on X at the next check-in" : "")
            Spacer(minLength: 0)
        }
    }

    private func toggleFollow(_ was: XActionState) {
        let on = !was.on
        Haptics.select()
        // Undoing a follow not yet done on X just cancels it.
        let done = was.done ?? false
        withAnimation(Motion.snappy) { XFollowTaps.shared.set(post.person, XActionState(on: on, pending: on != done, done: done)) }
        Task {
            await Repo.change("set_x_follow", ["personId": .string(post.person.id), "on": .bool(on)])
        }
    }

    private func toggle(_ kind: String, _ was: XActionState) {
        let on = !was.on
        Haptics.select()
        // Undoing something not yet done on X just cancels it: nothing left to wait for.
        let done = was.done ?? false
        withAnimation(Motion.snappy) { state[kind] = XActionState(on: on, pending: on != done, done: done) }
        Task {
            await Repo.change("set_x_post_action", ["postId": .string(post.id), "kind": .string(kind), "on": .bool(on)])
        }
    }
}
