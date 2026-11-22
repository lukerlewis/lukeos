import SwiftUI

/// A priority as one, two or three flames on a green, yellow or red tint (Luke's Notion colours).
struct PriorityChip: View {
    var priority: Priority
    @Environment(\.colorScheme) private var scheme

    private var colors: (bg: Color, fg: Color) {
        let dark = scheme == .dark
        switch priority {
        case .low: return dark ? (Color(UIColor(hex: 0x16A34A)).opacity(0.2), Color(UIColor(hex: 0x4ADE80))) : (Color(UIColor(hex: 0xDCFCE7)), Color(UIColor(hex: 0x16A34A)))
        case .medium: return dark ? (Color(UIColor(hex: 0xCA8A04)).opacity(0.2), Color(UIColor(hex: 0xFACC15))) : (Color(UIColor(hex: 0xFEF3C7)), Color(UIColor(hex: 0xCA8A04)))
        case .high: return dark ? (Color(UIColor(hex: 0xDC2626)).opacity(0.22), Color(UIColor(hex: 0xF87171))) : (Color(UIColor(hex: 0xFEE2E2)), Color(UIColor(hex: 0xDC2626)))
        }
    }

    var body: some View {
        HStack(spacing: 1) {
            ForEach(0..<priority.flames, id: \.self) { _ in
                Image(systemName: "flame").font(.system(size: 10.5, weight: .medium))
            }
        }
        .foregroundStyle(colors.fg)
        .padding(.horizontal, 5)
        .frame(height: 22)
        .background(colors.bg, in: .rect(cornerRadius: Radius.tag))
        .accessibilityLabel("\(priority.label) priority")
    }
}

/// A project as a chip tinted with its colour.
struct ProjectChip: View {
    var name: String
    var color: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let c = Color.project(color)
        Text(name)
            .font(.geist(.tag, medium: true))
            .lineLimit(1)
            .foregroundStyle(scheme == .dark ? c.mix(with: .white, by: 0.45) : c.mix(with: .black, by: 0.25))
            .padding(.horizontal, 6)
            .frame(height: 22)
            .background(c.opacity(scheme == .dark ? 0.24 : 0.14), in: .rect(cornerRadius: Radius.tag))
    }
}

/// Focus type: Shallow (boat), Focus (target), Deep work (headphones).
struct FocusChip: View {
    var effort: Effort
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: Self.symbol(effort)).font(.system(size: 10.5))
            Text(effort.label)
        }
        .font(.geist(.tag, medium: true))
        .foregroundStyle(Color.subtleText)
        .padding(.horizontal, 7)
        .frame(height: 22)
        .background(Color.raised, in: .rect(cornerRadius: Radius.tag))
    }

    static func symbol(_ e: Effort) -> String {
        switch e {
        case .shallow: "sailboat"
        case .focus: "scope"
        case .deep: "headphones"
        }
    }
}

/// A due date in the meta line. Late dates are medium-weight ink, not red.
struct DueLabel: View {
    var due: String
    var today: String
    var body: some View {
        let late = due < today
        HStack(spacing: 3) {
            Image(systemName: "calendar").font(.system(size: 10.5))
            Text(Day.friendly(due, today: today))
        }
        .font(.geist(.meta, medium: late))
        .foregroundStyle(late ? Color.ink : Color.mutedText)
    }
}
