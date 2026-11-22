import SwiftUI

/// A card: a rounded container a step lighter than the page, with a hairline edge. No shadow.
struct CardBox<Content: View>: View {
    var padding: CGFloat = 0
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.card, in: .rect(cornerRadius: Radius.card))
            .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Color.hairline, lineWidth: 1))
    }
}

/// A card's title row: icon, name, count.
struct CardHeader<Trailing: View>: View {
    var title: String
    var symbol: String?
    var count: Int?
    @ViewBuilder var trailing: Trailing

    init(_ title: String, symbol: String? = nil, count: Int? = nil, @ViewBuilder trailing: () -> Trailing = { EmptyView() }) {
        self.title = title
        self.symbol = symbol
        self.count = count
        self.trailing = trailing()
    }

    var body: some View {
        HStack(spacing: Space.s) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.icon(.row, weight: .regular))
                    .foregroundStyle(Color.icon)
                    .frame(width: Size.iconColumn)
            }
            Text(title).textStyle(.heading, medium: true, color: .ink)
            if let count, count > 0 {
                Text("\(count)").textStyle(.meta, color: .mutedText).monospacedDigit()
            }
            Spacer(minLength: 0)
            trailing
        }
        .padding(.horizontal, Space.inset)
        .padding(.top, Space.l)
        .padding(.bottom, Space.m)
    }
}

/// The round tick: empty for To do, half filled for Doing, solid with a tick for Done.
struct StatusCircle: View {
    var status: TaskStatus
    var size: CGFloat = 22

    var body: some View {
        ZStack {
            Circle()
                .strokeBorder(status == .todo ? Color.icon : Color.ink, lineWidth: 1.6)
            if status == .doing {
                HalfCircle().fill(Color.ink).padding(size * 0.06)
            }
            if status == .done {
                Circle().fill(Color.ink)
                Image(systemName: "checkmark")
                    .font(.system(size: size * 0.45, weight: .medium))
                    .foregroundStyle(Color.onSolid)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .frame(width: size, height: size)
        .animation(.snappy(duration: 0.22), value: status)
        .accessibilityLabel(status.label)
    }

    private struct HalfCircle: Shape {
        func path(in rect: CGRect) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: rect.midX, y: rect.minY))
            p.addArc(center: CGPoint(x: rect.midX, y: rect.midY), radius: rect.width / 2,
                     startAngle: .degrees(-90), endAngle: .degrees(90), clockwise: false)
            p.closeSubpath()
            return p
        }
    }
}

/// A small label: priority, list, project.
struct Tag: View {
    var text: String
    var symbol: String?
    var dot: Color?

    init(_ text: String, symbol: String? = nil, dot: Color? = nil) {
        self.text = text
        self.symbol = symbol
        self.dot = dot
    }

    var body: some View {
        HStack(spacing: Space.xs) {
            if let dot { Circle().fill(dot).frame(width: Size.dotSmall + 1, height: Size.dotSmall + 1) }
            if let symbol { Image(systemName: symbol).font(.icon(.meta)) }
            Text(text).lineLimit(1)
        }
        .font(.geist(.tag, medium: true))
        .foregroundStyle(Color.subtleText)
        .padding(.horizontal, Space.s)
        .frame(minHeight: Space.chip)
        .background(Color.raised, in: .rect(cornerRadius: Radius.tag))
        .overlay(RoundedRectangle(cornerRadius: Radius.tag).strokeBorder(Color.stroke, lineWidth: 1))
    }
}

/// The quiet mark on anything Claude made: a small faded sparkle.
struct ClaudeMark: View {
    var madeBy: MadeBy?
    var body: some View {
        if madeBy?.isClaude == true {
            Image(systemName: "sparkle")
                .font(.icon(.meta))
                .foregroundStyle(Color.mutedText.opacity(0.75))
                .accessibilityLabel("Made by \(madeBy?.name ?? "Claude")")
        }
    }
}

/// Blue 8pt dot for something unread.
struct UnreadDot: View {
    var body: some View { Circle().fill(Color.unread).frame(width: Size.unreadDot, height: Size.unreadDot) }
}

/// Red count badge.
struct CountBadge: View {
    var count: Int
    var body: some View {
        if count > 0 {
            Text(count > 99 ? "99+" : "\(count)")
                .font(.geist(.tag, medium: true))
                .monospacedDigit()
                .foregroundStyle(.white)
                .padding(.horizontal, Space.xs)
                .frame(minWidth: Space.xl, minHeight: Space.xl)
                .background(Color.notification, in: .capsule)
        }
    }
}

/// A project's colour dot.
struct ProjectDot: View {
    var color: String?
    var size: CGFloat = 8
    var body: some View { Circle().fill(Color.project(color)).frame(width: size, height: size) }
}

/// Shown when a list has nothing in it. Minimal copy.
struct EmptyNote: View {
    var text: String
    var symbol: String?
    var body: some View {
        VStack(spacing: Space.m) {
            if let symbol {
                Image(systemName: symbol).font(.icon(.transport, weight: .light)).foregroundStyle(Color.disabled)
            }
            Text(text).textStyle(.control, color: .mutedText)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Space.section + Space.m)
    }
}

/// The page background used by every screen.
struct PageBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .listSectionSpacing(Space.section)
            .environment(\.defaultMinListRowHeight, 52)
            .background(Color.page.ignoresSafeArea())
    }
}

extension View {
    func pageBackground() -> some View { modifier(PageBackground()) }

    /// A row inside a native List styled as a card row, with room to breathe.
    func cardRow() -> some View {
        self.listRowBackground(Color.card)
            .listRowSeparatorTint(Color.hairline)
            .listRowInsets(EdgeInsets(top: 12, leading: Space.inset, bottom: 12, trailing: Space.inset))
    }

    /// The insets for a task row in a list.
    func taskRowInsets() -> some View {
        listRowInsets(EdgeInsets(top: Space.row, leading: Space.inset, bottom: Space.row, trailing: Space.inset))
    }
}

/// Black (dark: white) solid button, as on the web.
struct SolidButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.geist(.control, medium: true))
            .foregroundStyle(enabled ? Color.onSolid : Color.disabled)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(enabled ? Color.ink : Color.muted, in: .capsule)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == SolidButtonStyle {
    static var solid: SolidButtonStyle { SolidButtonStyle() }
}

/// Medium-weight section title above a group.
struct SectionTitle: View {
    var text: String
    var body: some View {
        Text(text)
            .textStyle(.preview, medium: true, color: .mutedText)
            .textCase(nil)
            .padding(.bottom, Space.xs)
    }
}
