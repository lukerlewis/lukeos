import SwiftUI

/// Catching up on the X feed: every post Luke hasn't dealt with yet is a card on a pile.
/// Swipe a card left to skip it, right to reply; hold one to move it around. At the end: "All caught up".
struct XCatchUp: View {
    /// Changes when Luke has added or removed people, so the pile loads again.
    var peopleChanges = 0
    /// Leave the pile for the full list of posts.
    var onShowAll: () -> Void

    /// The pile, top card first. Nil until it has loaded.
    @State private var pile: [XPost]?
    @State private var hasPeople = true
    @State private var more: String?
    @State private var loadingMore = false
    /// How many cards are left, counting ones not loaded yet.
    @State private var left = 0
    /// Cards dealt with here, so a reload can't bring one back before the server has heard.
    @State private var done: Set<String> = []
    /// Skipped cards, latest last, for Undo.
    @State private var skipped: [XPost] = []
    /// How far the top card has been pulled toward leaving, 0 to 1: the cards behind rise to meet it.
    @State private var pull: CGFloat = 0
    @State private var fling: Fling?
    @State private var composing: XFeedScreen.Composer?

    /// Sends a card off by itself: after Skip is tapped, or once a reply is written.
    struct Fling: Equatable {
        var id: String
        var right: Bool
    }

    /// Cards drawn at once: the top one, two peeking out below, and one fading in as the top leaves.
    private static let shown = 4

    var body: some View {
        Group {
            if let pile {
                if let top = pile.first {
                    VStack(spacing: Space.l) {
                        stack(pile)
                        controls(top)
                    }
                    .padding(.horizontal, Space.page)
                    .padding(.top, Space.s)
                    .padding(.bottom, Space.l)
                } else if !hasPeople {
                    EmptyNote(text: "Add people to follow.", symbol: "at").frame(maxHeight: .infinity)
                } else if more != nil {
                    // The next cards are on their way.
                    DelayedSpinner().frame(maxHeight: .infinity, alignment: .top)
                } else {
                    caughtUp
                }
            } else {
                DelayedSpinner().frame(maxHeight: .infinity, alignment: .top)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(Motion.snappy, value: pile?.isEmpty)
        .pageBackground()
        .toolbar {
            if !skipped.isEmpty {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: undo) { Image(systemName: "arrow.uturn.backward") }
                        .accessibilityLabel("Undo skip")
                }
            }
        }
        .sheet(item: $composing) { c in
            XReplySheet(post: c.post, reply: c.reply, kind: c.kind, onSave: {
                // A new reply or quote deals with the card: it leaves to the right.
                if c.reply == nil { fling = Fling(id: c.post.id, right: true) }
            }) { Task { await load() } }
        }
        .task(id: peopleChanges) { await load() }
    }

    private func stack(_ pile: [XPost]) -> some View {
        ZStack {
            ForEach(Array(pile.prefix(Self.shown).enumerated()), id: \.element.id) { depth, post in
                // Where the card sits in the pile, easing up a place as the top card is pulled away.
                let place = max(0, CGFloat(depth) - pull)
                XCatchUpCard(
                    id: post.id, isTop: depth == 0, fling: fling,
                    onPull: { pull = $0 },
                    onReply: { composing = XFeedScreen.Composer(post: post) },
                    onGone: { right in gone(post, replied: right) }
                ) {
                    XPostRow(post: post, onWrite: { composing = XFeedScreen.Composer(post: post, kind: $0) },
                             onEdit: { composing = XFeedScreen.Composer(post: post, reply: $0, kind: $0.kind ?? "reply") },
                             onChanged: { Task { await load() } })
                }
                .scaleEffect(depth == 0 ? 1 : 1 - 0.05 * place, anchor: .bottom)
                .offset(y: depth == 0 ? 0 : Space.m * place)
                .opacity(depth == 0 ? 1 : min(1, max(0, CGFloat(Self.shown - 1) - place)))
                .zIndex(Double(-depth))
                .allowsHitTesting(depth == 0)
                .accessibilityHidden(depth != 0)
            }
        }
        // Room for the two cards peeking out below.
        .padding(.bottom, Space.m * 2)
    }

    private func controls(_ top: XPost) -> some View {
        HStack {
            Button { fling = Fling(id: top.id, right: false) } label: {
                Image(systemName: "xmark").font(.icon(.bar)).frame(width: Size.tap, height: Size.tap)
            }
            .buttonStyle(.glass).buttonBorderShape(.circle)
            .accessibilityLabel("Skip")
            Spacer()
            Text("\(left) left").textStyle(.meta, color: .mutedText).rollingNumber(left)
            Spacer()
            Button { composing = XFeedScreen.Composer(post: top) } label: {
                Image(systemName: "arrowshape.turn.up.left").font(.icon(.bar)).frame(width: Size.tap, height: Size.tap)
            }
            .buttonStyle(.glassProminent).buttonBorderShape(.circle).tint(.ink)
            .accessibilityLabel("Reply")
        }
    }

    private var caughtUp: some View {
        VStack(spacing: Space.l) {
            Image(systemName: "checkmark.circle").font(.system(size: 44, weight: .light)).foregroundStyle(Color.disabled)
            Text("All caught up").textStyle(.heading, medium: true, color: .text)
            Button("See all posts", action: onShowAll)
                .font(.geist(.control))
                .tint(Color.subtleText)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .transition(.opacity.combined(with: .scale(scale: 0.96)))
    }

    /// A card has left the pile: skipped (left) or replied to (right).
    private func gone(_ post: XPost, replied: Bool) {
        done.insert(post.id)
        if !replied { skipped.append(post) }
        if fling?.id == post.id { fling = nil }
        // The cards behind have already risen with the pull, so the pile just steps up in place.
        pull = 0
        pile?.removeAll { $0.id == post.id }
        left = max(pile?.count ?? 0, left - 1)
        Task { await Repo.change("set_x_post_caught_up", ["postId": .string(post.id), "caughtUp": true]) }
        if pile?.isEmpty == true {
            if more == nil {
                Haptics.success()
                // Nothing left to read: the New dots in the list go too.
                Task { await Repo.change("mark_x_feed_seen", [:]) }
            }
        }
        if (pile?.count ?? 0) < 5 { Task { await loadMore() } }
    }

    private func undo() {
        guard let post = skipped.popLast() else { return }
        Haptics.tap()
        done.remove(post.id)
        withAnimation(Motion.snappy) {
            pile = [post] + (pile ?? [])
            left += 1
        }
        Task { await Repo.change("set_x_post_caught_up", ["postId": .string(post.id), "caughtUp": false]) }
    }

    private func load() async {
        guard let f = try? await Repo.fetch("get_x_feed", ["view": "catch_up", "limit": 30], as: XFeed.self) else {
            if pile == nil { pile = [] }
            return
        }
        let fresh = f.posts.filter { !done.contains($0.id) }
        hasPeople = !f.people.isEmpty
        more = f.more
        left = max(fresh.count, (f.toCatchUp ?? fresh.count) - (f.posts.count - fresh.count))
        withAnimation(pile == nil ? nil : Motion.snappy) { pile = fresh }
    }

    private func loadMore() async {
        guard let before = more, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        guard let f = try? await Repo.fetch("get_x_feed", ["view": "catch_up", "limit": 30, "before": .string(before)], as: XFeed.self) else { return }
        let have = Set((pile ?? []).map(\.id))
        pile = (pile ?? []) + f.posts.filter { !done.contains($0.id) && !have.contains($0.id) }
        more = f.more
        if pile?.isEmpty == true, more != nil { await loadMore() }
    }
}

/// One card on the catch-up pile. It follows the finger anywhere; let go past either side and it's
/// skipped (left) or answered (right), otherwise it settles back on the pile.
private struct XCatchUpCard<Content: View>: View {
    var id: String
    var isTop: Bool
    var fling: XCatchUp.Fling?
    var onPull: (CGFloat) -> Void
    var onReply: () -> Void
    var onGone: (_ right: Bool) -> Void
    @ViewBuilder var content: Content

    @State private var drag: CGSize = .zero
    @State private var moving = false
    /// A long post scrolls inside its card; an up-and-down drag then belongs to the scrolling.
    @State private var scrolling = false
    @State private var leaving = false
    @State private var contentHeight: CGFloat = 0
    @State private var cardHeight: CGFloat = 0
    /// Which side the card is past, for one tap of feedback as it crosses: -1 skip, 1 reply.
    @State private var side = 0

    /// How far sideways a card must be let go to count.
    private static var reach: CGFloat { 110 }
    private var overflows: Bool { contentHeight > cardHeight + 1 }

    var body: some View {
        ScrollView {
            content
                .padding(Space.inset)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
        }
        .scrollDisabled(!overflows)
        .scrollIndicators(.hidden)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { cardHeight = $0 }
        .background(Color.card)
        .clipShape(.rect(cornerRadius: Radius.card))
        .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(moving ? Color.stroke : Color.hairline, lineWidth: 1))
        .overlay { stamp }
        .scaleEffect(moving ? 1.02 : 1)
        .rotationEffect(.degrees(Double(drag.width / 18)))
        .offset(drag)
        .simultaneousGesture(dragging, isEnabled: isTop && !leaving)
        .onChange(of: fling) {
            if let fling, fling.id == id, !leaving { leave(right: fling.right) }
        }
        .accessibilityAction(named: "Skip") { leave(right: false) }
        .accessibilityAction(named: "Reply", onReply)
    }

    /// What letting go here would do, fading in over the card as it nears either side.
    private var stamp: some View {
        let amount = min(1, max(0, (abs(drag.width) - 30) / (Self.reach - 30)))
        return Label(drag.width > 0 ? "Reply" : "Skip", systemImage: drag.width > 0 ? "arrowshape.turn.up.left.fill" : "xmark")
            .font(.geist(.control, medium: true))
            .foregroundStyle(Color.onSolid)
            .padding(.horizontal, Space.l).padding(.vertical, Space.m)
            .background(Color.ink, in: .capsule)
            .opacity(amount)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private var dragging: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { v in
                if scrolling { return }
                if !moving {
                    // Reading a long post up and down scrolls it; any other drag picks the card up.
                    if overflows, abs(v.translation.height) > abs(v.translation.width) {
                        scrolling = true
                        return
                    }
                    withAnimation(Motion.snappy) { moving = true }
                }
                drag = v.translation
                onPull(min(1, abs(drag.width) / 150))
                let now = drag.width > Self.reach ? 1 : drag.width < -Self.reach ? -1 : 0
                if now != side {
                    side = now
                    if now != 0 { Haptics.select() }
                }
            }
            .onEnded { v in
                defer { scrolling = false }
                guard moving else { return }
                side = 0
                let x = v.translation.width, flick = v.predictedEndTranslation.width
                if x < -Self.reach || (x < -40 && flick < -320) {
                    leave(right: false)
                } else {
                    if x > Self.reach || (x > 40 && flick > 320) { onReply() }
                    settle()
                }
            }
    }

    /// Back onto the pile.
    private func settle() {
        withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
            drag = .zero
            moving = false
            onPull(0)
        }
    }

    /// Off the screen to one side, then out of the pile.
    private func leave(right: Bool) {
        leaving = true
        if !moving { Haptics.tap() }
        withAnimation(.easeOut(duration: 0.26)) {
            drag = CGSize(width: right ? 640 : -640, height: drag.height + 30)
            moving = false
            onPull(1)
        } completion: {
            onGone(right)
        }
    }
}
