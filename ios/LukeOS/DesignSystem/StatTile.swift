import SwiftUI

/// One number in a card: a small icon and title, the value large, and an optional line under it
/// (an average, a goal, a change). A missing value shows a dash, never 0.
/// Used for Health's Today tiles; meant for any page with a grid of numbers (Screen Time, Focus stats).
struct StatTile: View {
    var title: String
    var symbol: String? = nil
    var value: String?
    var detail: String? = nil
    /// Reserve the detail line even when it's empty, so tiles in a row line up.
    var keepsDetailLine = true

    var body: some View {
        CardBox(padding: Space.l) {
            VStack(alignment: .leading, spacing: Space.s) {
                HStack(spacing: Space.xs) {
                    if let symbol { Image(systemName: symbol).font(.icon(.meta)).foregroundStyle(Color.icon) }
                    Text(title).textStyle(.meta, color: .mutedText).lineLimit(1)
                }
                Text(value ?? "–").textStyle(.section, medium: true, color: .ink).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.8)
                if detail != nil || keepsDetailLine {
                    Text(detail ?? " ").textStyle(.tag, color: .mutedText).lineLimit(1)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title), \(value ?? "no data")\(detail.map { ", \($0)" } ?? "")")
    }
}
