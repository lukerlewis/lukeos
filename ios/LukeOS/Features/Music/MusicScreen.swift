import SwiftUI
import Observation

@MainActor @Observable
final class MusicModel {
    static let shared = MusicModel()
    var episodes: [Episode] = []
    var playlists: [Playlist] = []
    var loaded = false

    func load() async {
        if !loaded {
            if let c = await Repo.cached("list_episodes", ["status": "all"], as: EpisodeList.self) { episodes = c.episodes }
            if let c = await Repo.cached("list_playlists", as: PlaylistList.self) { playlists = c.playlists }
        }
        if let f = try? await Repo.fetch("list_episodes", ["status": "all"], as: EpisodeList.self) { episodes = f.episodes }
        if let f = try? await Repo.fetch("list_playlists", as: PlaylistList.self) { playlists = f.playlists }
        loaded = true
    }

    var songs: [Episode] { episodes.filter { !$0.isPodcast } }
    var podcasts: [Episode] { episodes.filter { $0.isPodcast && (!$0.isFinished || $0.kept == true) } }

    /// All songs, without those on playlists left out of shuffle.
    func shuffleable() async -> [Episode] {
        var left: Set<String> = []
        for p in playlists where p.excludedFromShuffle == true {
            if let full = try? await Repo.fetch("get_playlist", ["id": .string(p.id)], as: Playlist.self) {
                left.formUnion((full.episodes ?? []).map(\.id))
            }
        }
        return songs.filter { !left.contains($0.id) }
    }

    func mark(_ ep: Episode, finished: Bool) {
        if let i = episodes.firstIndex(of: ep) { episodes[i].finishedAt = finished ? ISO8601DateFormatter.withFractional.string(from: .now) : nil }
        Task { await Repo.change("update_episode", ["id": .string(ep.id), "finished": .bool(finished)]) }
    }

    func keep(_ ep: Episode) {
        if let i = episodes.firstIndex(of: ep) { episodes[i].kept = true }
        Task { await Repo.change("update_episode", ["id": .string(ep.id), "kept": true]) }
    }

    func delete(_ ep: Episode) {
        withAnimation(Motion.snappy) { episodes.removeAll { $0.id == ep.id } }
        Downloads.shared.remove(ep)
        Task { await Repo.change("delete_episode", ["id": .string(ep.id)]) }
    }

    func add(_ ep: Episode, to p: Playlist) {
        Task {
            await Repo.change("add_to_playlist", ["playlistId": .string(p.id), "episodeIds": [.string(ep.id)]])
            Toasts.shared.show("Added to \(p.title)")
            await load()
        }
    }

    func newPlaylist(_ title: String) {
        Task {
            await Repo.change("create_playlist", ["title": .string(title)])
            await load()
        }
    }
}

/// Music: the library (songs and episodes) and playlists. Adding music happens on the computer.
struct MusicScreen: View {
    @State private var model = MusicModel.shared
    @State private var player = AudioPlayer.shared
    @AppStorage("musicTab", store: SharedConfig.defaults) private var tab = "library"
    @State private var naming = false
    @State private var newTitle = ""
    @State private var confirmDelete: Episode?
    @Namespace private var zoom

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("", selection: $tab) {
                        Text("Library").tag("library")
                        Text("Playlists").tag("playlists")
                    }
                    .pickerStyle(.segmented)
                    .controlRow()
                }

                if tab == "library" { library } else { playlistsList }
            }
            .listStyle(.insetGrouped)
            .pageBackground()
            .navigationTitle("Music")
            .navigationDestination(for: Playlist.self) { PlaylistScreen(playlist: $0).zoomTransition($0.id, in: zoom) }
            .toolbar {
                if tab == "playlists" {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { newTitle = ""; naming = true } label: { Image(systemName: "plus") }
                            .accessibilityLabel("New playlist")
                    }
                }
            }
            .refreshable { await model.load() }
            .task { await model.load() }
            .alert("New playlist", isPresented: $naming) {
                TextField("Name", text: $newTitle)
                Button("Create") { if !newTitle.isEmpty { model.newPlaylist(newTitle) } }
                Button("Cancel", role: .cancel) {}
            }
            .confirmationDialog("Delete “\(confirmDelete?.title ?? "")”?", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }), titleVisibility: .visible) {
                Button("Delete for good", role: .destructive) { if let e = confirmDelete { model.delete(e) } }
            } message: {
                Text(confirmDelete?.isPodcast == false ? "Its file is deleted for good." : "This can't be undone.")
            }
            .sheet(item: $player.justFinished) { ep in FinishedSheet(episode: ep) }
        }
    }

    @ViewBuilder
    private var library: some View {
        if !model.songs.isEmpty {
            Section {
                ForEach(Array(model.songs.enumerated()), id: \.element.id) { i, ep in
                    episodeRow(ep) { player.play(model.songs, from: i) }
                }
            } header: {
                HStack {
                    SectionTitle(text: "Songs")
                    Spacer()
                    Button { player.play(model.songs) } label: { Image(systemName: "play.fill") }
                        .accessibilityLabel("Play all")
                    Button {
                        Task { let list = await model.shuffleable(); player.play(list.shuffled()) }
                    } label: { Image(systemName: "shuffle") }
                        .accessibilityLabel("Shuffle")
                        .padding(.leading, Space.row)
                }
                .font(.icon(.meta))
                .foregroundStyle(Color.ink)
            }
        }
        Section {
            if model.loaded && model.podcasts.isEmpty && model.songs.isEmpty {
                EmptyNote(text: "Add music on your computer.", symbol: "music.note").listRowBackground(Color.clear)
            }
            ForEach(Array(model.podcasts.enumerated()), id: \.element.id) { i, ep in
                episodeRow(ep) { player.play(Array(model.podcasts[i...]), from: 0) }
            }
        } header: { if !model.podcasts.isEmpty { SectionTitle(text: "Episodes") } }
    }

    private var playlistsList: some View {
        Section {
            if model.loaded && model.playlists.isEmpty { EmptyNote(text: "No playlists yet.").listRowBackground(Color.clear) }
            ForEach(model.playlists) { p in
                NavigationLink(value: p) {
                    HStack(spacing: Space.row) {
                        PlaylistArt(playlist: p, size: Size.artworkRow)
                            .zoomSource(p.id, in: zoom)
                        VStack(alignment: .leading, spacing: Space.xs) {
                            Text(p.title).textStyle(.control, medium: true, color: .ink)
                            Text(Self.summary(p.count ?? 0, p.seconds ?? 0))
                                .textStyle(.meta, color: .mutedText)
                        }
                    }
                }
                .cardRow()
            }
        }
    }

    /// "Empty", "1 item · 3 min", "3 items · 2 hr 9 min".
    static func summary(_ count: Int, _ seconds: Double) -> String {
        count == 0 ? "Empty" : "\(count) \(count == 1 ? "item" : "items") · \(Episode.time(seconds, long: true))"
    }

    private func episodeRow(_ ep: Episode, play: @escaping () -> Void) -> some View {
        EpisodeRow(episode: ep, playing: player.current?.id == ep.id)
            .contentShape(.rect)
            .onTapGesture(perform: play)
            .cardRow()
            .swipeActions(edge: .leading) {
                Button { player.playNext(ep) } label: { Label("Play next", systemImage: "text.line.first.and.arrowtriangle.forward") }
                    .tint(Color.swipePrimary)
            }
            .contextMenu { EpisodeMenu(episode: ep, onDelete: { confirmDelete = ep }) }
    }
}

/// Play next, Add to playlist, Download, Mark finished, Keep, Delete.
struct EpisodeMenu: View {
    var episode: Episode
    var onDelete: () -> Void
    @State private var model = MusicModel.shared
    @State private var downloads = Downloads.shared

    var body: some View {
        Button("Play next", systemImage: "text.line.first.and.arrowtriangle.forward") { AudioPlayer.shared.playNext(episode) }
        Menu("Add to playlist", systemImage: "text.badge.plus") {
            ForEach(model.playlists) { p in Button(p.title) { model.add(episode, to: p) } }
        }
        if downloads.saved.contains(episode.id) {
            Button("Remove download", systemImage: "arrow.down.circle.dotted") { downloads.remove(episode) }
        } else {
            Button("Download", systemImage: "arrow.down.circle") { downloads.download(episode) }
        }
        if episode.isPodcast {
            Button(episode.isFinished ? "Mark unplayed" : "Mark finished", systemImage: "checkmark.circle") {
                model.mark(episode, finished: !episode.isFinished)
            }
            if episode.isFinished && episode.kept != true {
                Button("Keep", systemImage: "bookmark") { model.keep(episode) }
            }
        }
        Divider()
        Button("Delete", systemImage: "trash", role: .destructive, action: onDelete)
    }
}

/// A song or episode: artwork, title, show, length or time left, a playing marker.
struct EpisodeRow: View {
    var episode: Episode
    var playing: Bool
    @State private var downloads = Downloads.shared

    var body: some View {
        HStack(spacing: Space.row) {
            Artwork(path: episode.artworkUrl, size: Size.artworkRow)
            VStack(alignment: .leading, spacing: Space.xs) {
                Text(episode.title).textStyle(.control, medium: true, color: playing ? .ink : .text).lineLimit(1)
                HStack(spacing: Space.xs) {
                    if let show = episode.show { Text(show).lineLimit(1) }
                    if !episode.lengthLabel.isEmpty {
                        if episode.show != nil { Text("·") }
                        Text(episode.lengthLabel).monospacedDigit().layoutPriority(1)
                    }
                }
                .textStyle(.meta, color: .mutedText)
            }
            Spacer(minLength: 4)
            if downloads.inProgress.contains(episode.id) {
                ProgressView().controlSize(.mini)
            } else if downloads.saved.contains(episode.id) {
                Image(systemName: "arrow.down.circle.fill").font(.icon(.meta)).foregroundStyle(Color.icon)
            }
            if playing {
                Image(systemName: "waveform").symbolEffect(.variableColor.iterative, isActive: AudioPlayer.shared.isPlaying)
                    .foregroundStyle(Color.ink).font(.icon(.meta))
            }
        }
        .padding(.vertical, Space.xs)
        .opacity(episode.isFinished && episode.isPodcast ? 0.55 : 1)
    }
}

/// Artwork, or a headphones tile when there's none.
struct Artwork: View {
    var path: String?
    var size: CGFloat
    var body: some View {
        ZStack {
            Rectangle().fill(Color.muted)
            Image(systemName: "headphones").font(.system(size: size * 0.38, weight: .light)).foregroundStyle(Color.icon)
            if let path, !path.isEmpty, !path.contains("example.com") {
                RemoteImage(path: path, contentMode: .fill)
            }
        }
        .frame(width: size, height: size)
        .clipShape(.rect(cornerRadius: size > 100 ? 22 : Radius.tile))
    }
}

struct PlaylistArt: View {
    var playlist: Playlist
    var size: CGFloat
    var body: some View {
        if let icon = playlist.icon, !icon.isEmpty {
            Text(icon).font(.system(size: size * 0.45))
                .frame(width: size, height: size)
                .background(Color.muted, in: .rect(cornerRadius: size > 100 ? 22 : Radius.tile))
        } else {
            Artwork(path: playlist.artworkUrl, size: size)
        }
    }
}

/// A playlist: art, count and time, Play, Shuffle, reorder, remove.
struct PlaylistScreen: View {
    var playlist: Playlist
    @State private var full: Playlist?
    @State private var player = AudioPlayer.shared
    @State private var confirmDelete = false
    @State private var downloads = Downloads.shared
    @Environment(\.dismiss) private var dismiss

    private var episodes: [Episode] { full?.episodes ?? [] }

    var body: some View {
        List {
            VStack(spacing: Space.m) {
                PlaylistArt(playlist: playlist, size: Size.playlistHero)
                Text(playlist.title).textStyle(.section, medium: true, color: .ink)
                Text(MusicScreen.summary(episodes.count, episodes.reduce(0) { $0 + ($1.durationSeconds ?? 0) }))
                    .textStyle(.meta, color: .mutedText)
                HStack(spacing: Space.m) {
                    Button { player.play(episodes) } label: { Label("Play", systemImage: "play.fill").frame(maxWidth: .infinity) }
                    Button { player.play(episodes.shuffled()) } label: { Label("Shuffle", systemImage: "shuffle").frame(maxWidth: .infinity) }
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .font(.geist(.control, medium: true))
                .tint(.ink)
                .disabled(episodes.isEmpty)
                .padding(.top, Space.line)
            }
            .frame(maxWidth: .infinity)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 10, trailing: 0))

            Section {
                if full != nil && episodes.isEmpty { EmptyNote(text: "Nothing on this playlist yet.").listRowBackground(Color.clear) }
                ForEach(Array(episodes.enumerated()), id: \.element.id) { i, ep in
                    EpisodeRow(episode: ep, playing: player.current?.id == ep.id)
                        .contentShape(.rect)
                        .onTapGesture { player.play(episodes, from: i) }
                        .cardRow()
                        .swipeActions {
                            Button("Remove", systemImage: "minus.circle", role: .destructive) { remove(ep) }
                        }
                        .contextMenu {
                            Button("Play next", systemImage: "text.line.first.and.arrowtriangle.forward") { player.playNext(ep) }
                            Button("Remove from playlist", systemImage: "minus.circle", role: .destructive) { remove(ep) }
                        }
                }
                .onMove(perform: move)
            }
        }
        .listStyle(.insetGrouped)
        .pageBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Download all", systemImage: "arrow.down.circle") { episodes.forEach(downloads.download) }
                    Button(playlist.excludedFromShuffle == true ? "Include in shuffle" : "Leave out of shuffle", systemImage: "shuffle") {
                        Task { await Repo.change("update_playlist", ["id": .string(playlist.id), "excludeFromShuffle": .bool(!(playlist.excludedFromShuffle ?? false))]) }
                    }
                    Divider()
                    Button("Delete playlist", systemImage: "trash", role: .destructive) { confirmDelete = true }
                } label: { Image(systemName: "ellipsis") }
            }
            ToolbarItem(placement: .topBarTrailing) { EditButton() }
        }
        .confirmationDialog("Delete this playlist?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                Task { await Repo.change("delete_playlist", ["id": .string(playlist.id)]); await MusicModel.shared.load() }
                dismiss()
            }
        } message: { Text("The songs and episodes stay in your library.") }
        .task {
            if let c = await Repo.cached("get_playlist", ["id": .string(playlist.id)], as: Playlist.self) { full = c }
            if let f = try? await Repo.fetch("get_playlist", ["id": .string(playlist.id)], as: Playlist.self) { full = f }
        }
    }

    private func remove(_ ep: Episode) {
        withAnimation { full?.episodes?.removeAll { $0.id == ep.id } }
        Task { await Repo.change("remove_from_playlist", ["playlistId": .string(playlist.id), "episodeIds": [.string(ep.id)]]) }
    }

    private func move(_ from: IndexSet, _ to: Int) {
        full?.episodes?.move(fromOffsets: from, toOffset: to)
        Task { await Repo.change("update_playlist", ["id": .string(playlist.id), "episodeIds": .array(episodes.map { .string($0.id) })]) }
    }
}

/// After a podcast ends: keep it or delete it.
struct FinishedSheet: View {
    var episode: Episode
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(spacing: Space.row) {
            Artwork(path: episode.artworkUrl, size: Size.finishedArt)
            Text("Finished").textStyle(.meta, color: .mutedText)
            Text(episode.title).textStyle(.heading, medium: true, color: .ink).multilineTextAlignment(.center)
            HStack(spacing: Space.m) {
                Button("Keep") { MusicModel.shared.keep(episode); dismiss() }
                    .buttonStyle(.bordered).controlSize(.large).tint(.ink)
                Button("Delete") { MusicModel.shared.delete(episode); dismiss() }
                    .buttonStyle(.borderedProminent).controlSize(.large).tint(.ink)
            }
            .font(.geist(.control, medium: true))
        }
        .padding(Space.xxl)
        .presentationDetents([.height(300)])
    }
}
