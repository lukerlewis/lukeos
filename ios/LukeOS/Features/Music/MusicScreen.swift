import SwiftUI
import Observation
@MainActor @Observable final class AudioPlayer {
    static let shared = AudioPlayer()
    var current: String?
    func configureSession() {}
}
struct MusicScreen: View { var body: some View { NavigationStack { Text("Music").navigationTitle("Music") } } }
struct MiniPlayer: View { var onOpen: () -> Void; var body: some View { Text("") } }
struct NowPlayingSheet: View { var body: some View { Text("") } }
