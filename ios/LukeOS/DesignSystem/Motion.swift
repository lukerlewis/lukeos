import SwiftUI
import UIKit

/// Motion in one place: the app's springs, calmer when Reduce Motion is on, and the zoom
/// transition that lets a page grow out of the card or row that was tapped.
enum Motion {
    /// The spring used for list and layout changes. With Reduce Motion it's a short fade-like ease.
    static var snappy: Animation {
        UIAccessibility.isReduceMotionEnabled ? .easeInOut(duration: 0.18) : .snappy
    }
}

extension View {
    /// Marks the thing a page zooms out of (a card, a row, artwork).
    @ViewBuilder
    func zoomSource(_ id: String, in ns: Namespace.ID?) -> some View {
        if let ns { self.matchedTransitionSource(id: id, in: ns) } else { self }
    }

    /// Makes a pushed page or sheet zoom out of its source. The system falls back to a cross-fade with Reduce Motion.
    @ViewBuilder
    func zoomTransition(_ id: String, in ns: Namespace.ID?) -> some View {
        if let ns { self.navigationTransition(.zoom(sourceID: id, in: ns)) } else { self }
    }

    /// A number that rolls when it changes (counts, totals).
    func rollingNumber(_ value: Int) -> some View {
        self.monospacedDigit()
            .contentTransition(.numericText(value: Double(value)))
            .animation(Motion.snappy, value: value)
    }
}
