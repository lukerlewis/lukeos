import ActivityKit
import AVFoundation
import Observation
import UserNotifications
import UIKit

enum FocusMode: String, Codable, CaseIterable, Sendable {
    case pomodoro, timer, sprint
    var label: String { self == .pomodoro ? "Pomodoro" : self == .timer ? "Timer" : "Sprint" }
}

enum FocusPhase: String, Codable, Sendable {
    case focus, short, long
    var label: String { self == .focus ? "Focus" : self == .short ? "Short break" : "Long break" }
}

struct SprintTask: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var title: String
    var done: Bool
}

/// The focus timers: Pomodoro, a count-up Timer and Sprints. Times are kept as end dates rather than
/// counted ticks, so they stay right while the app is closed. Every focus stretch of a minute or more is
/// logged with its own id, so it can be saved again as it grows and retried safely.
@MainActor @Observable
final class FocusTimer {
    static let shared = FocusTimer()

    struct Run: Codable {
        var endsAt: Date?
        var leftSeconds: Double?
        var lengthSeconds: Double = 0
        var startedAt: Date?
        var sessionId: String?
        var savedSeconds: Int = 0
    }

    struct State: Codable {
        var mode: FocusMode = .pomodoro
        var phase: FocusPhase = .focus
        var round = 0
        var pomodoro = Run()
        // Timer (counts up)
        var timerStartedAt: Date?
        var timerRunningSince: Date?
        var timerBanked: Double = 0
        var timerSessionId: String?
        // Sprint
        var sprintMinutes = 25
        var sprintTasks: [SprintTask] = []
        var sprint = Run()
        var sprintFinished = false
    }

    var settings = AppHome.FocusSettings.standard
    var state = State() { didSet { persist() } }
    /// Ticks once a second while something runs, so time on screen moves.
    private(set) var now = Date()
    var brownNoise = false { didSet { setBrownNoise(brownNoise) } }

    private var ticker: Timer?
    private var noise: AVAudioPlayer?
    private let key = "focusState"

    private init() {
        if let data = SharedConfig.defaults.data(forKey: key), let saved = try? JSONDecoder().decode(State.self, from: data) {
            state = saved
        }
        if isRunning { startTicking() }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(state) { SharedConfig.defaults.set(data, forKey: key) }
    }

    // MARK: Reading

    var isRunning: Bool {
        state.pomodoro.endsAt != nil || state.timerRunningSince != nil || state.sprint.endsAt != nil
    }

    func length(_ phase: FocusPhase) -> Double {
        Double(phase == .focus ? settings.focusMinutes : phase == .short ? settings.shortBreakMinutes : settings.longBreakMinutes) * 60
    }

    func left(_ run: Run, default length: Double) -> Double {
        if let end = run.endsAt { return max(0, end.timeIntervalSince(now)) }
        return run.leftSeconds ?? length
    }

    var pomodoroLeft: Double { left(state.pomodoro, default: length(state.phase)) }
    var pomodoroLength: Double { state.pomodoro.lengthSeconds > 0 ? state.pomodoro.lengthSeconds : length(state.phase) }
    var timerElapsed: Double { state.timerBanked + (state.timerRunningSince.map { now.timeIntervalSince($0) } ?? 0) }
    var sprintLength: Double { state.sprint.lengthSeconds > 0 ? state.sprint.lengthSeconds : Double(state.sprintMinutes * 60) }
    var sprintLeft: Double { left(state.sprint, default: sprintLength) }

    /// What the Focus tab says while something runs: the time left (or elapsed).
    var tabText: String {
        if state.pomodoro.endsAt != nil { return Self.clock(pomodoroLeft) }
        if state.sprint.endsAt != nil { return Self.clock(sprintLeft) }
        if state.timerRunningSince != nil { return Self.clock(timerElapsed) }
        return "Focus"
    }

    static func clock(_ s: Double) -> String {
        let t = Int(s.rounded(.up))
        return t >= 3600 ? String(format: "%d:%02d:%02d", t / 3600, (t % 3600) / 60, t % 60) : String(format: "%d:%02d", t / 60, t % 60)
    }

    // MARK: Pomodoro

    func startPomodoro() {
        var run = state.pomodoro
        let len = run.lengthSeconds > 0 ? run.lengthSeconds : length(state.phase)
        run.lengthSeconds = len
        let remaining = run.leftSeconds ?? len
        run.endsAt = Date.now.addingTimeInterval(remaining)
        run.leftSeconds = nil
        if run.startedAt == nil { run.startedAt = .now }
        if state.phase == .focus, run.sessionId == nil { run.sessionId = UUID().uuidString.lowercased() }
        state.pomodoro = run
        Haptics.tap()
        schedule(at: run.endsAt!, body: state.phase == .focus ? "Focus done. Time for a break." : "Break over. Back to focus.")
        startTicking()
        updateActivity()
    }

    func pausePomodoro() {
        guard state.pomodoro.endsAt != nil else { return }
        state.pomodoro.leftSeconds = pomodoroLeft
        state.pomodoro.endsAt = nil
        logPomodoro()
        cancelNotification()
        updateActivity()
    }

    func resetPomodoro() {
        logPomodoro()
        state.pomodoro = Run()
        cancelNotification()
        updateActivity()
    }

    func skipPomodoro() {
        logPomodoro()
        advance()
    }

    private func focusedSeconds(_ run: Run) -> Double {
        guard state.phase == .focus else { return 0 }
        let len = run.lengthSeconds > 0 ? run.lengthSeconds : length(.focus)
        return len - left(run, default: len)
    }

    private func logPomodoro(endedAt: Date = .now) {
        guard state.phase == .focus else { return }
        let seconds = focusedSeconds(state.pomodoro)
        log(kind: "pomodoro", run: &state.pomodoro, seconds: seconds, endedAt: endedAt)
    }

    /// The phase after this one: a break after focus (long every few rounds), then focus again.
    private func advance() {
        if state.phase != .focus {
            if state.phase == .long { state.round = 0 }
            state.phase = .focus
        } else {
            state.round += 1
            state.phase = state.round >= settings.roundsBeforeLongBreak ? .long : .short
        }
        state.pomodoro = Run()
        cancelNotification()
        updateActivity()
    }

    // MARK: Timer

    func startTimer() {
        if state.timerStartedAt == nil {
            state.timerStartedAt = .now
            state.timerSessionId = UUID().uuidString.lowercased()
        }
        state.timerRunningSince = .now
        Haptics.tap()
        startTicking()
        updateActivity()
    }

    func pauseTimer() {
        state.timerBanked = timerElapsed
        state.timerRunningSince = nil
        updateActivity()
    }

    func stopTimer() {
        let seconds = timerElapsed
        var run = Run(startedAt: state.timerStartedAt, sessionId: state.timerSessionId)
        log(kind: "timer", run: &run, seconds: seconds, endedAt: .now)
        state.timerStartedAt = nil
        state.timerRunningSince = nil
        state.timerBanked = 0
        state.timerSessionId = nil
        updateActivity()
    }

    // MARK: Sprint

    func startSprint() {
        var run = state.sprint
        let len = run.lengthSeconds > 0 ? run.lengthSeconds : Double(state.sprintMinutes * 60)
        run.lengthSeconds = len
        run.endsAt = Date.now.addingTimeInterval(run.leftSeconds ?? len)
        run.leftSeconds = nil
        if run.startedAt == nil { run.startedAt = .now; run.sessionId = UUID().uuidString.lowercased() }
        state.sprint = run
        state.sprintFinished = false
        Haptics.tap()
        schedule(at: run.endsAt!, body: "Sprint done.")
        startTicking()
        updateActivity()
    }

    func pauseSprint() {
        guard state.sprint.endsAt != nil else { return }
        state.sprint.leftSeconds = sprintLeft
        state.sprint.endsAt = nil
        logSprint()
        cancelNotification()
        updateActivity()
    }

    /// Ends the sprint now (or when its time runs out) and shows what got done.
    func finishSprint() {
        logSprint()
        state.sprint.endsAt = nil
        state.sprint.leftSeconds = 0
        state.sprintFinished = true
        cancelNotification()
        updateActivity()
    }

    func newSprint() {
        state.sprint = Run()
        state.sprintFinished = false
        state.sprintTasks.removeAll { $0.done }
    }

    private func logSprint() {
        let seconds = sprintLength - sprintLeft
        let label = state.sprintTasks.map(\.title).joined(separator: ", ")
        log(kind: "sprint", run: &state.sprint, seconds: seconds, endedAt: .now, label: label.isEmpty ? nil : String(label.prefix(200)))
    }

    func toggleSprintTask(_ t: SprintTask) {
        guard let i = state.sprintTasks.firstIndex(of: t) else { return }
        state.sprintTasks[i].done.toggle()
        Haptics.tap()
        if let task = TaskStore.shared.task(t.id) {
            TaskStore.shared.setStatus(task, state.sprintTasks[i].done ? .done : .todo)
        } else {
            Task { await Repo.change("update_task", ["id": .string(t.id), "status": .string(state.sprintTasks[i].done ? "done" : "todo")]) }
        }
    }

    // MARK: Ticking, logging, notifications

    private func startTicking() {
        guard ticker == nil else { return }
        now = .now
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            MainActor.assumeIsolated { FocusTimer.shared.tick() }
        }
    }

    private func tick() {
        now = .now
        if let end = state.pomodoro.endsAt, end <= now {
            logPomodoro(endedAt: end)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            advance()
        }
        if let end = state.sprint.endsAt, end <= now {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            finishSprint()
        }
        // Save a long stretch as it goes, so nothing is lost if the phone dies.
        if Int(now.timeIntervalSince1970) % 60 == 0 {
            if state.pomodoro.endsAt != nil { logPomodoro() }
            if state.sprint.endsAt != nil { logSprint() }
        }
        if !isRunning {
            ticker?.invalidate()
            ticker = nil
        }
    }

    private func log(kind: String, run: inout Run, seconds: Double, endedAt: Date, label: String? = nil) {
        let secs = Int(seconds.rounded())
        guard secs >= 60, secs != run.savedSeconds else { return }
        let id = run.sessionId ?? UUID().uuidString.lowercased()
        run.sessionId = id
        run.savedSeconds = secs
        var input: Input = [
            "id": .string(id), "kind": .string(kind), "seconds": .number(Double(secs)),
            "startedAt": .string(ISO8601DateFormatter.withFractional.string(from: run.startedAt ?? endedAt.addingTimeInterval(-seconds))),
            "endedAt": .string(ISO8601DateFormatter.withFractional.string(from: endedAt)),
        ]
        if let label { input["label"] = .string(label) }
        Task {
            await Repo.change("log_focus_session", input)
            // Enough focus time may unlock the apps Luke blocked.
            await ScreenTime.shared.refresh()
        }
    }

    private func schedule(at date: Date, body: String) {
        let content = UNMutableNotificationContent()
        content.title = "LukeOS"
        content.body = body
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, date.timeIntervalSinceNow), repeats: false)
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "focus", content: content, trigger: trigger))
    }

    private func cancelNotification() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["focus"])
    }

    // MARK: Live Activity

    private func updateActivity() {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let content: FocusActivityAttributes.ContentState?
        if let end = state.pomodoro.endsAt {
            content = .init(label: state.phase.label, endsAt: end, startedAt: nil, pausedText: nil, countsUp: false, progressStart: end.addingTimeInterval(-pomodoroLength))
        } else if let end = state.sprint.endsAt {
            content = .init(label: "Sprint", endsAt: end, startedAt: nil, pausedText: nil, countsUp: false, progressStart: end.addingTimeInterval(-sprintLength))
        } else if let since = state.timerRunningSince {
            content = .init(label: "Timer", endsAt: nil, startedAt: since.addingTimeInterval(-state.timerBanked), pausedText: nil, countsUp: true, progressStart: nil)
        } else if state.pomodoro.leftSeconds != nil {
            content = .init(label: state.phase.label, endsAt: nil, startedAt: nil, pausedText: Self.clock(pomodoroLeft), countsUp: false, progressStart: nil)
        } else if state.timerStartedAt != nil {
            content = .init(label: "Timer", endsAt: nil, startedAt: nil, pausedText: Self.clock(timerElapsed), countsUp: true, progressStart: nil)
        } else {
            content = nil
        }
        if let content {
            let stale = content.endsAt?.addingTimeInterval(60)
            if !Activity<FocusActivityAttributes>.activities.isEmpty {
                Task.detached { await Self.updateAll(content, stale: stale) }
            } else {
                _ = try? Activity.request(attributes: FocusActivityAttributes(mode: state.mode.rawValue),
                                          content: ActivityContent(state: content, staleDate: stale))
            }
        } else {
            Task.detached { await Self.endAll() }
        }
    }

    nonisolated private static func updateAll(_ content: FocusActivityAttributes.ContentState, stale: Date?) async {
        for a in Activity<FocusActivityAttributes>.activities { await a.update(ActivityContent(state: content, staleDate: stale)) }
    }

    nonisolated private static func endAll() async {
        for a in Activity<FocusActivityAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
    }

    // MARK: Brown noise

    private func setBrownNoise(_ on: Bool) {
        if on {
            if noise == nil, let url = Bundle.main.url(forResource: "brown-noise", withExtension: "mp3") {
                noise = try? AVAudioPlayer(contentsOf: url)
                noise?.numberOfLoops = -1
                noise?.volume = 0.7
            }
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try? AVAudioSession.sharedInstance().setActive(true)
            noise?.play()
        } else {
            noise?.pause()
            AudioPlayer.shared.configureSession()
        }
    }
}
