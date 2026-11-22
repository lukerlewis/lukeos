import ActivityKit
import Foundation

/// The running focus timer on the lock screen.
struct FocusActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// "Focus", "Short break", "Long break", "Timer", "Sprint".
        var label: String
        /// When it ends (counting down), or when it started (counting up). Nil while paused.
        var endsAt: Date?
        var startedAt: Date?
        /// Shown while paused.
        var pausedText: String?
        var countsUp: Bool
        var progressStart: Date?
    }

    var mode: String
}
