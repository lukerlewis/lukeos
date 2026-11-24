import SwiftUI

struct XPersonRef: Codable, Hashable, Sendable {
    var id: String
    var handle: String
    var name: String?
    var avatarUrl: String?
    var display: String { name?.isEmpty == false ? name! : handle }
}

struct XPerson: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var handle: String
    var name: String?
    var avatarUrl: String?
    var url: String
    var checkedAt: String?
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
}

struct XFeed: Codable, Hashable, Sendable {
    var people: [XPerson]
    var posts: [XPost]
    var more: String?
    var checkedAt: String?
}

/// X feed: posts from the people Luke picks on X, and his replies to them.
/// Claude posts the replies on X at the next check-in, exactly as he wrote them.
struct XFeedScreen: View {
    @State private var feed: XFeed?
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

    private var input: Input { person.map { ["personId": .string($0)] } ?? [:] }

    var body: some View {
        List {
            if let feed, feed.people.count > 1 {
                Section {
                    ScrollView(.horizontal) {
                        HStack(spacing: Space.s) {
                            ChipToggle(label: "Everyone", on: person == nil) { pick(nil) }
                            ForEach(feed.people) { p in
                                ChipToggle(label: p.name?.isEmpty == false ? p.name! : "@\(p.handle)", on: person == p.id) { pick(p.id) }
                            }
                        }
                        .padding(.horizontal, Space.xl)
                    }
                    .scrollIndicators(.hidden)
                    .controlRow()
                }
            }
            Section {
                if let feed {
                    if feed.people.isEmpty {
                        EmptyNote(text: "Add people to follow.", symbol: "at").listRowBackground(Color.clear)
                    } else if feed.posts.isEmpty {
                        EmptyNote(text: "No posts yet.", symbol: "at").listRowBackground(Color.clear)
                    }
                    ForEach(feed.posts) { post in
                        XPostRow(post: post, onReply: { composing = Composer(post: post) },
                                 onEdit: { composing = Composer(post: post, reply: $0) },
                                 onChanged: { Task { await load() } })
                            .cardRow()
                            .contextMenu {
                                Button("Reply", systemImage: "bubble.left") { composing = Composer(post: post) }
                                if let url = URL(string: post.url) { Link(destination: url) { Label("Open on X", systemImage: "arrow.up.right.square") } }
                                Button("Remove from feed", systemImage: "trash", role: .destructive) { remove(post) }
                            }
                    }
                    if feed.more != nil {
                        Button { Task { await loadMore() } } label: {
                            Text("Older posts").textStyle(.control, color: .subtleText).frame(maxWidth: .infinity)
                        }
                        .disabled(loadingMore)
                        .cardRow()
                    }
                } else {
                    DelayedSpinner().listRowBackground(Color.clear)
                }
            } header: {
                if let at = feed?.checkedAt { SectionTitle(text: "Checked \(Stamp.relative(at))") }
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

    private func pick(_ id: String?) {
        person = id
        feed?.posts = []
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

    var body: some View {
        HStack(alignment: .top, spacing: Space.m) {
            XAvatar(url: post.person.avatarUrl, name: post.person.display)
            VStack(alignment: .leading, spacing: Space.s) {
                HStack(spacing: Space.xs) {
                    Text(post.person.display).textStyle(.meta, medium: true, color: .ink).lineLimit(1)
                    Text("@\(post.person.handle) · \(Stamp.relative(post.postedAt))").textStyle(.meta, color: .mutedText).lineLimit(1)
                    Spacer(minLength: 0)
                    if post.isNew { UnreadDot() }
                }
                if !post.text.isEmpty {
                    Text(linked(post.text)).textStyle(.body, color: .subtleText)
                        .tint(Color.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let first = post.media.first {
                    RemoteImage(path: first, contentMode: .fill)
                        .frame(maxWidth: .infinity)
                        .frame(height: 220)
                        .clipShape(.rect(cornerRadius: Radius.card))
                        .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Color.hairline, lineWidth: 1))
                        .overlay(alignment: .bottomTrailing) {
                            if post.media.count > 1 { Tag("+\(post.media.count - 1)").padding(Space.s) }
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
                Button(action: onReply) {
                    Label("Reply", systemImage: "bubble.left").textStyle(.meta, color: .subtleText)
                        .frame(minHeight: Size.tap)
                }
                .buttonStyle(.borderless)
            }
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
    @State private var adding = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: Space.m) {
                        TextField("@username", text: $handle)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
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
                    ForEach(people) { p in
                        HStack(spacing: Space.m) {
                            XAvatar(url: p.avatarUrl, name: p.name ?? p.handle)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name?.isEmpty == false ? p.name! : "@\(p.handle)").textStyle(.control, color: .text)
                                if p.name?.isEmpty == false { Text("@\(p.handle)").textStyle(.meta, color: .mutedText) }
                            }
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

    private func add() {
        let h = handle.trimmingCharacters(in: .whitespaces)
        guard !h.isEmpty else { return }
        adding = true
        error = nil
        Task {
            defer { adding = false }
            do {
                let p = try await Repo.create("follow_x_person", ["handle": .string(h)], as: XPerson.self)
                if !people.contains(where: { $0.id == p.id }) { people.insert(p, at: 0) }
                handle = ""
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
