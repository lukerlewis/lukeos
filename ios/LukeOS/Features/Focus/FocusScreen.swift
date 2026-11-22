import SwiftUI
import Observation
@MainActor @Observable final class FocusTimer {
    static let shared = FocusTimer()
    var settings = AppHome.FocusSettings.standard
    var isRunning = false
    var tabText: String { "Focus" }
}
struct FocusScreen: View { var body: some View { NavigationStack { Text("Focus").navigationTitle("Focus") } } }
