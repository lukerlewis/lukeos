import SwiftUI

/// A tappable filter chip: "All", or a project with its dot and count.
struct ChipToggle: View {
    var label: String
    var count: Int?
    var color: String?
    var on: Bool
    var action: () -> Void

    var body: some View {
        Button {
            Haptics.select()
            action()
        } label: {
            HStack(spacing: Space.line) {
                if let color { ProjectDot(color: color) }
                Text(label)
                if let count { Text("\(count)").foregroundStyle(Color.mutedText).monospacedDigit() }
            }
            .font(.geist(.preview, medium: true))
            .foregroundStyle(on ? Color.ink : Color.subtleText)
            .padding(.horizontal, Space.row)
            .frame(minHeight: Size.filterChip)
            .background(on ? Color.selected : Color.card, in: .capsule)
            .overlay(Capsule().strokeBorder(on ? Color.strokeStrong : Color.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

/// Pinned notes, documents or links as a sideways row of cards.
struct PinnedRow: View {
    struct Item: Identifiable, Hashable {
        var id: String
        var title: String
        var excerpt: String?
        var project: ProjectRef?
        var madeBy: MadeBy?
        var unread = false
    }

    var items: [Item]
    /// Pass a namespace to let the opened page zoom out of its card.
    var zoom: Namespace.ID? = nil
    var onOpen: (String) -> Void

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Space.m) {
                ForEach(items) { item in
                    Button { onOpen(item.id) } label: {
                        VStack(alignment: .leading, spacing: Space.s) {
                            HStack(spacing: Space.xs) {
                                if item.unread { UnreadDot() }
                                Text(item.title).textStyle(.preview, medium: true, color: .ink).lineLimit(2)
                                    .multilineTextAlignment(.leading)
                                ClaudeMark(madeBy: item.madeBy)
                            }
                            if let ex = item.excerpt, !ex.isEmpty {
                                Text(ex).textStyle(.meta, color: .mutedText).lineLimit(3).multilineTextAlignment(.leading)
                            }
                            Spacer(minLength: 0)
                            if let p = item.project {
                                HStack(spacing: Space.xs) {
                                    ProjectDot(color: p.color, size: Size.dotSmall)
                                    Text(p.name).textStyle(.tag, color: .mutedText).lineLimit(1)
                                }
                            }
                        }
                        .padding(Space.l)
                        .frame(width: Size.pinnedCard.width, height: Size.pinnedCard.height, alignment: .topLeading)
                        .background(Color.card, in: .rect(cornerRadius: Radius.container + 4))
                        .overlay(RoundedRectangle(cornerRadius: Radius.container + 4).strokeBorder(Color.hairline, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .zoomSource(item.id, in: zoom)
                }
            }
            .padding(.horizontal, Space.xl)
        }
        .scrollIndicators(.hidden)
    }
}
