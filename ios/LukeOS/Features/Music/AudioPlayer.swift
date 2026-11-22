import AVFoundation
import MediaPlayer
import Observation
import UIKit

struct Episode: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var kind: String
    var title: String
    var show: String?
    var src: String?
    var artworkUrl: String?
    var description: String?
    var durationSeconds: Double?
    var positionSeconds: Double?
    var lastPlayedAt: String?
    var finishedAt: String?
    var kept: Bool?
    var bytes: Int?
    var madeBy: MadeBy?

    var isPodcast: Bool { kind == "podcast" }
    var isFinished: Bool { finishedAt != nil }

    /// "12 min left", "45 min", "3:20".
    var lengthLabel: String {
        let total = durationSeconds ?? 0
        if isPodcast, let pos = positionSeconds, pos > 5, total > 0, pos < total - 10 {
            return "\(max(1, Int((total - pos) / 60))) min left"
        }
        return Self.time(total, long: total >= 3600 || isPodcast)
    }

    static func time(_ s: Double, long: Bool = false) -> String {
        guard s.isFinite, s > 0 else { return long ? "" : "0:00" }
        let secs = Int(s)
        if long, secs >= 60 { return secs >= 3600 ? "\(secs / 3600) hr \((secs % 3600) / 60) min" : "\(secs / 60) min" }
        return secs >= 3600 ? String(format: "%d:%02d:%02d", secs / 3600, (secs % 3600) / 60, secs % 60) : String(format: "%d:%02d", secs / 60, secs % 60)
    }
}

struct EpisodeList: Codable, Sendable { var episodes: [Episode] }

struct Playlist: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var title: String
    var icon: String?
    var count: Int?
    var seconds: Double?
    var artworkUrl: String?
    var excludedFromShuffle: Bool?
    var episodes: [Episode]?
}

struct PlaylistList: Codable, Sendable { var playlists: [Playlist] }

/// Plays songs and episodes in the background, with the lock screen, Control Center and AirPods
/// controls, resuming where Luke left off and saving his place every 15 seconds and on pause.
@MainActor @Observable
final class AudioPlayer {
    static let shared = AudioPlayer()

    private(set) var queue: [Episode] = []
    private(set) var index = 0
    var current: Episode? { queue.indices.contains(index) ? queue[index] : nil }
    private(set) var isPlaying = false
    private(set) var position: Double = 0
    private(set) var duration: Double = 0
    private(set) var loading = false
    var speed: Float = SharedConfig.defaults.object(forKey: "speed") as? Float ?? 1 {
        didSet {
            SharedConfig.defaults.set(speed, forKey: "speed")
            if isPlaying { player.rate = speed }
            updateNowPlaying()
        }
    }
    /// A podcast that just ended, so the screen can offer to delete or keep it.
    var justFinished: Episode?

    private let player = AVPlayer()
    private var timeObserver: Any?
    private var lastSaved = Date.distantPast
    private var artwork: MPMediaItemArtwork?

    private init() {
        player.automaticallyWaitsToMinimizeStalling = true
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] t in
            MainActor.assumeIsolated { self?.tick(t.seconds) }
        }
        NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: nil, queue: .main) { [weak self] note in
            let item = ObjectIdentifier(note.object as AnyObject)
            MainActor.assumeIsolated {
                guard let self, let current = self.player.currentItem, ObjectIdentifier(current) == item else { return }
                self.ended()
            }
        }
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init)
            let resume = ((note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0) & AVAudioSession.InterruptionOptions.shouldResume.rawValue != 0
            MainActor.assumeIsolated {
                if type == .began { self?.markPaused() } else if type == .ended, resume { self?.play() }
            }
        }
        NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt).flatMap(AVAudioSession.RouteChangeReason.init)
            // Unplugging headphones pauses, as on every iPhone.
            MainActor.assumeIsolated { if reason == .oldDeviceUnavailable { self?.pause() } }
        }
        setUpRemoteCommands()
    }

    func configureSession() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, policy: .longFormAudio)
    }

    // MARK: Playing

    /// Plays a list from one of its items. Podcasts carry on from where Luke stopped; songs start at the top.
    func play(_ list: [Episode], from start: Int = 0) {
        guard list.indices.contains(start) else { return }
        saveNow()
        queue = list
        index = start
        load(list[start], autoplay: true)
    }

    func playNext(_ ep: Episode) {
        guard current != nil else { play([ep]); return }
        queue.removeAll { $0.id == ep.id && $0.id != current?.id }
        queue.insert(ep, at: min(index + 1, queue.count))
        Toasts.shared.show("Playing next")
    }

    private func load(_ ep: Episode, autoplay: Bool) {
        guard let url = Self.url(for: ep) else {
            Toasts.shared.show("That episode couldn't be loaded.")
            return
        }
        var options: [String: Any] = [:]
        if url.host() == LukeAPI.shared.baseURL.host(), let token = TokenStore.token {
            options["AVURLAssetHTTPHeaderFieldsKey"] = ["authorization": "Bearer \(token)"]
        }
        let item = AVPlayerItem(asset: AVURLAsset(url: url, options: options))
        player.replaceCurrentItem(with: item)
        let total = ep.durationSeconds ?? 0
        let resume = !SharedConfig.isDemo && ep.isPodcast && !(total > 0 && (ep.positionSeconds ?? 0) > total - 10) ? (ep.positionSeconds ?? 0) : 0
        position = resume
        duration = total
        if resume > 0 { player.seek(to: CMTime(seconds: resume, preferredTimescale: 600)) }
        loading = true
        artwork = nil
        loadArtwork(ep)
        if autoplay { play() }
        updateNowPlaying()
        Task { await Repo.change("update_episode", ["id": .string(ep.id), "played": true]) }
    }

    func play() {
        guard player.currentItem != nil else { if let c = current { load(c, autoplay: true) }; return }
        configureSession()
        try? AVAudioSession.sharedInstance().setActive(true)
        player.playImmediately(atRate: speed)
        isPlaying = true
        updateNowPlaying()
    }

    func pause() {
        player.pause()
        markPaused()
    }

    private func markPaused() {
        isPlaying = false
        saveNow()
        updateNowPlaying()
    }

    func toggle() { isPlaying ? pause() : play() }

    func seek(to seconds: Double) {
        let s = max(0, min(seconds, duration > 0 ? duration - 1 : seconds))
        position = s
        player.seek(to: CMTime(seconds: s, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        updateNowPlaying()
    }

    func skip(_ delta: Double) { seek(to: position + delta) }

    func next() {
        saveNow()
        guard index + 1 < queue.count else { return }
        index += 1
        load(queue[index], autoplay: isPlaying || true)
    }

    func previous() {
        if position > 5 || index == 0 { seek(to: 0); return }
        saveNow()
        index -= 1
        load(queue[index], autoplay: true)
    }

    func stop() {
        saveNow()
        player.replaceCurrentItem(with: nil)
        queue = []
        isPlaying = false
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    private func tick(_ seconds: Double) {
        guard seconds.isFinite else { return }
        if loading, player.timeControlStatus == .playing { loading = false }
        position = seconds
        if let d = player.currentItem?.duration.seconds, d.isFinite, d > 0 { duration = d }
        if isPlaying, Date.now.timeIntervalSince(lastSaved) > 15 { saveNow() }
    }

    /// Saves where Luke is (podcasts only; songs always start at the top).
    private func saveNow() {
        guard let ep = current, ep.isPodcast, position > 1 else { return }
        lastSaved = .now
        queue[index].positionSeconds = position
        Task {
            await Repo.change("update_episode", [
                "id": .string(ep.id), "positionSeconds": .number(position.rounded()),
                "durationSeconds": duration > 0 ? .number(duration.rounded()) : .null, "played": true,
            ].filter { !$0.value.isNull })
        }
    }

    private func ended() {
        guard let done = current else { return }
        if done.isPodcast {
            Task { await Repo.change("update_episode", ["id": .string(done.id), "finished": true]) }
            queue[index].finishedAt = ISO8601DateFormatter.withFractional.string(from: .now)
            justFinished = done
        } else {
            Task { await Repo.change("update_episode", ["id": .string(done.id), "positionSeconds": 0]) }
        }
        if index + 1 < queue.count {
            index += 1
            load(queue[index], autoplay: true)
        } else {
            isPlaying = false
            position = 0
            seek(to: 0)
            updateNowPlaying()
        }
    }

    static func url(for ep: Episode) -> URL? {
        if let local = Downloads.shared.file(for: ep) { return local }
        guard let src = ep.src else { return nil }
        if SharedConfig.isDemo {
            // Demo: the bundled songs stand in for everything.
            return Bundle.main.url(forResource: "Fixtures", withExtension: nil).flatMap { folder in
                (try? FileManager.default.contentsOfDirectory(at: folder.appending(path: "files"), includingPropertiesForKeys: nil))?
                    .filter { $0.pathExtension == "mp3" }.sorted { $0.path < $1.path }.first
            }
        }
        return LukeAPI.shared.fileURL(src)
    }

    // MARK: Lock screen

    private func setUpRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.play() }; return .success }
        c.pauseCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.pause() }; return .success }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.toggle() }; return .success }
        c.nextTrackCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.next() }; return .success }
        c.previousTrackCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.previous() }; return .success }
        c.skipForwardCommand.preferredIntervals = [30]
        c.skipBackwardCommand.preferredIntervals = [15]
        c.skipForwardCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.skip(30) }; return .success }
        c.skipBackwardCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.skip(-15) }; return .success }
        c.changePlaybackPositionCommand.addTarget { [weak self] e in
            let t = (e as? MPChangePlaybackPositionCommandEvent)?.positionTime ?? 0
            MainActor.assumeIsolated { self?.seek(to: t) }
            return .success
        }
    }

    private func updateNowPlaying() {
        guard let ep = current else { MPNowPlayingInfoCenter.default().nowPlayingInfo = nil; return }
        let c = MPRemoteCommandCenter.shared()
        // Podcasts get skip buttons; songs get next and previous.
        c.skipForwardCommand.isEnabled = ep.isPodcast
        c.skipBackwardCommand.isEnabled = ep.isPodcast
        c.nextTrackCommand.isEnabled = !ep.isPodcast || index + 1 < queue.count
        c.previousTrackCommand.isEnabled = !ep.isPodcast
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: ep.title,
            MPMediaItemPropertyArtist: ep.show ?? "LukeOS",
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? Double(speed) : 0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
        ]
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = isPlaying ? .playing : .paused
    }

    private func loadArtwork(_ ep: Episode) {
        guard let path = ep.artworkUrl else { return }
        Task {
            guard let image = await ImageStore.shared.image(path), current?.id == ep.id else { return }
            artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            updateNowPlaying()
        }
    }
}

/// Songs and episodes kept on the phone for listening without signal.
@MainActor @Observable
final class Downloads {
    static let shared = Downloads()

    private(set) var saved: Set<String> = []
    private(set) var inProgress: Set<String> = []

    private let dir: URL = {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "Downloads")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var url = d
        try? url.setResourceValues(values)
        return d
    }()

    private init() {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path())) ?? []
        saved = Set(files.map { ($0 as NSString).deletingPathExtension })
    }

    private func path(_ id: String, ext: String = "mp3") -> URL { dir.appending(path: "\(id).\(ext)") }

    func file(for ep: Episode) -> URL? {
        guard saved.contains(ep.id) else { return nil }
        let url = path(ep.id, ext: (ep.src.map { ($0 as NSString).pathExtension }).flatMap { $0.isEmpty || $0.count > 4 ? nil : $0 } ?? "mp3")
        return FileManager.default.fileExists(atPath: url.path()) ? url : nil
    }

    func download(_ ep: Episode) {
        guard !saved.contains(ep.id), !inProgress.contains(ep.id), let src = AudioPlayer.url(for: ep) else { return }
        inProgress.insert(ep.id)
        let ext = (ep.src.map { ($0 as NSString).pathExtension }).flatMap { $0.isEmpty || $0.count > 4 ? nil : $0 } ?? "mp3"
        let target = path(ep.id, ext: ext)
        Task {
            var req = URLRequest(url: src)
            if src.host() == LukeAPI.shared.baseURL.host(), let token = TokenStore.token {
                req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
            }
            do {
                let (tmp, _) = src.isFileURL ? (src, URLResponse()) : try await URLSession.shared.download(for: req)
                try? FileManager.default.removeItem(at: target)
                try FileManager.default.copyItem(at: tmp, to: target)
                saved.insert(ep.id)
            } catch {
                Toasts.shared.show("Couldn't download it.")
            }
            inProgress.remove(ep.id)
        }
    }

    func remove(_ ep: Episode) {
        for ext in ["mp3", "m4a", "aac", "wav", "mp4"] { try? FileManager.default.removeItem(at: path(ep.id, ext: ext)) }
        saved.remove(ep.id)
    }

    var bytesUsed: Int64 {
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey])) ?? []
        return files.reduce(0) { $0 + Int64((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
    }

    func removeAll() {
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        saved = []
    }
}
