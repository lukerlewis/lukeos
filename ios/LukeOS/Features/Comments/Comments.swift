import SwiftUI

struct Comment: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var quote: String?
    var body: String
    var resolved: Bool?
    var madeBy: MadeBy
    var createdAt: String
    var replies: [Comment]?
}

/// Comment threads on a task, note or document. "@claude" in a comment asks Claude.
struct CommentThreads: View {
    var targetType: String
    var targetId: String
    @State private var threads: [Comment] = []
    @State private var draft = ""
    @State private var replyingTo: Comment?
    @State private var loaded = false
    @FocusState private var focused: Bool

    private var input: Input { ["targetType": .string(targetType), "targetId": .string(targetId)] }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(threads) { thread in
                VStack(alignment: .leading, spacing: 10) {
                    if let quote = thread.quote, !quote.isEmpty {
                        Text(quote).textStyle(.meta, color: .mutedText).lineLimit(2)
                            .padding(.leading, 10)
                            .overlay(alignment: .leading) { Rectangle().fill(Color.stroke).frame(width: 2) }
                    }
                    CommentBubble(comment: thread)
                    ForEach(thread.replies ?? []) { reply in CommentBubble(comment: reply).padding(.leading, 18) }
                    HStack(spacing: 16) {
                        Button("Reply") { replyingTo = thread; focused = true }
                        Button(thread.resolved == true ? "Reopen" : "Resolve") { resolve(thread) }
                        Spacer()
                    }
                    .font(.geist(.meta, medium: true))
                    .foregroundStyle(Color.mutedText)
                    .buttonStyle(.plain)
                }
                .opacity(thread.resolved == true ? 0.55 : 1)
                .contextMenu {
                    Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = thread.body }
                    Button("Delete", systemImage: "trash", role: .destructive) { delete(thread) }
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                if let r = replyingTo {
                    HStack {
                        Text("Replying to \(r.madeBy.isClaude ? "Claude" : "your comment")").textStyle(.meta, color: .mutedText)
                        Button { replyingTo = nil } label: { Image(systemName: "xmark.circle.fill") }
                            .foregroundStyle(Color.icon).buttonStyle(.plain)
                    }
                }
                HStack(alignment: .bottom, spacing: 8) {
                    TextField("Add a comment", text: $draft, axis: .vertical)
                        .font(.geist(.control))
                        .lineLimit(1...6)
                        .focused($focused)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(Color.raised, in: .rect(cornerRadius: 18))
                    Button(action: send) {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Color.onSolid)
                            .frame(width: 36, height: 36)
                            .background(draft.trimmingCharacters(in: .whitespaces).isEmpty ? Color.disabled : Color.ink, in: .circle)
                    }
                    .buttonStyle(.plain)
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityLabel("Send")
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        if let cached = await Repo.cached("list_comments", input, as: [Comment].self) { threads = cached }
        if let fresh = try? await Repo.fetch("list_comments", input, as: [Comment].self) { threads = fresh }
        loaded = true
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        let mine = Comment(id: UUID().uuidString, body: text, madeBy: .luke, createdAt: ISO8601DateFormatter.withFractional.string(from: .now))
        if let r = replyingTo, let i = threads.firstIndex(where: { $0.id == r.id }) {
            threads[i].replies = (threads[i].replies ?? []) + [mine]
            replyingTo = nil
            Task {
                await Repo.change("reply_to_comment", ["id": .string(r.id), "body": .string(text)])
                await load()
            }
        } else {
            threads.append(mine)
            Task {
                await Repo.change("add_comment", input.merging(["body": .string(text)]) { $1 })
                await load()
            }
        }
        Haptics.tap()
    }

    private func resolve(_ c: Comment) {
        let resolved = !(c.resolved ?? false)
        if let i = threads.firstIndex(of: c) { threads[i].resolved = resolved }
        Task { await Repo.change("resolve_comment", ["id": .string(c.id), "resolved": .bool(resolved)]) }
    }

    private func delete(_ c: Comment) {
        threads.removeAll { $0.id == c.id }
        Task { await Repo.change("delete_comment", ["id": .string(c.id)]) }
    }
}

struct CommentBubble: View {
    var comment: Comment
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 5) {
                Text(comment.madeBy.isClaude ? (comment.madeBy.name ?? "Claude") : "Luke")
                    .textStyle(.meta, medium: true, color: .text)
                ClaudeMark(madeBy: comment.madeBy)
                Text(Stamp.relative(comment.createdAt)).textStyle(.meta, color: .mutedText)
            }
            Text(LocalizedStringKey(comment.body))
                .textStyle(.preview, color: .subtleText)
                .tint(.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
