import SwiftUI

/// The tab bar: Dashboard, Notes, Focus, Music, More. Liquid Glass, shrinking as you scroll,
/// with the music mini player sitting on it while something is playing.
struct MainTabs: View {
    @Environment(AppModel.self) private var app
    @State private var player = AudioPlayer.shared
    @State private var focus = FocusTimer.shared
    @State private var showPlayer = false

    var body: some View {
        @Bindable var app = app
        TabView(selection: $app.tab) {
            Tab("Dashboard", systemImage: "square.grid.2x2", value: AppTab.dashboard) {
                DashboardScreen()
            }
            Tab("Notes", systemImage: "note.text", value: AppTab.notes) {
                NotesScreen()
            }
            Tab(value: AppTab.focus) {
                FocusScreen()
            } label: {
                Label(focus.isRunning ? focus.tabText : "Focus", systemImage: "timer")
            }
            Tab("Music", systemImage: "music.note", value: AppTab.music) {
                MusicScreen()
            }
            Tab("More", systemImage: "ellipsis", value: AppTab.more) {
                MoreScreen()
            }
            .badge(Home.shared.unread)
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewBottomAccessory(isEnabled: player.current != nil) {
            MiniPlayer(onOpen: { showPlayer = true })
        }
        .sheet(isPresented: $showPlayer) {
            NowPlayingSheet()
        }
        .task {
            await Home.shared.refresh()
        }
    }
}
