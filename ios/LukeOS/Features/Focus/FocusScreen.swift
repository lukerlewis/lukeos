import SwiftUI
import Charts

/// Focus: Pomodoro, a count-up Timer and Sprints, with brown noise and stats.
struct FocusScreen: View {
    @State private var timer = FocusTimer.shared
    @State private var showSettings = false
    @State private var showStats = false

    var body: some View {
        @Bindable var timer = timer
        NavigationStack {
            ScrollView {
                VStack(spacing: 26) {
                    Picker("Mode", selection: $timer.state.mode) {
                        ForEach(FocusMode.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .disabled(timer.isRunning)

                    switch timer.state.mode {
                    case .pomodoro: PomodoroView()
                    case .timer: StopwatchView()
                    case .sprint: SprintView()
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 110)
            }
            .pageBackground()
            .navigationTitle("Focus")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        timer.brownNoise.toggle()
                    } label: {
                        Image(systemName: timer.brownNoise ? "speaker.wave.2.fill" : "speaker.slash")
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .accessibilityLabel(timer.brownNoise ? "Brown noise on" : "Brown noise off")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showStats = true } label: { Image(systemName: "chart.bar") }
                        .accessibilityLabel("Stats")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "slider.horizontal.3") }
                        .accessibilityLabel("Timer lengths")
                }
            }
            .sheet(isPresented: $showSettings) { FocusSettingsSheet() }
            .sheet(isPresented: $showStats) { FocusStatsSheet() }
            .task {
                if let focus = try? await Repo.fetch("get_focus", as: AppHome.Focus.self) { timer.settings = focus.settings }
            }
        }
    }
}

/// The ring that empties as time runs out, with the time in the middle.
struct FocusRing: View {
    var progress: Double
    var time: String
    var caption: String
    var running: Bool

    var body: some View {
        ZStack {
            Circle().stroke(Color.muted, lineWidth: 10)
            Circle()
                .trim(from: 0, to: max(0.0001, progress))
                .stroke(Color.ink, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 1), value: progress)
            VStack(spacing: 6) {
                Text(time)
                    .font(.geist(size: 64, medium: false))
                    .monospacedDigit()
                    .tracking(-2.5)
                    .foregroundStyle(Color.ink)
                    .contentTransition(.numericText(countsDown: true))
                Text(caption).textStyle(.control, color: .mutedText)
            }
        }
        .frame(width: 280, height: 280)
        .padding(.top, 10)
        .accessibilityElement(children: .combine)
    }
}

/// Reset, Play/Pause, Skip.
struct FocusControls: View {
    var running: Bool
    var onReset: (() -> Void)?
    var onToggle: () -> Void
    var onSkip: (() -> Void)?
    var skipSymbol = "forward.end.fill"

    var body: some View {
        HStack(spacing: 34) {
            Button { onReset?() } label: { Image(systemName: "arrow.counterclockwise").frame(width: 54, height: 54) }
                .buttonStyle(.glass).buttonBorderShape(.circle)
                .opacity(onReset == nil ? 0 : 1).disabled(onReset == nil)
                .accessibilityLabel("Reset")
            Button(action: onToggle) {
                Image(systemName: running ? "pause.fill" : "play.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(Color.onSolid)
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 84, height: 84)
            }
            .buttonStyle(.glassProminent).buttonBorderShape(.circle).tint(.ink)
            .accessibilityLabel(running ? "Pause" : "Start")
            Button { onSkip?() } label: { Image(systemName: skipSymbol).frame(width: 54, height: 54) }
                .buttonStyle(.glass).buttonBorderShape(.circle)
                .opacity(onSkip == nil ? 0 : 1).disabled(onSkip == nil)
                .accessibilityLabel("Skip")
        }
        .font(.system(size: 19))
        .foregroundStyle(Color.ink)
        .sensoryFeedback(.impact(weight: .light), trigger: running)
    }
}

struct PomodoroView: View {
    @State private var timer = FocusTimer.shared

    var body: some View {
        let running = timer.state.pomodoro.endsAt != nil
        let started = running || timer.state.pomodoro.leftSeconds != nil
        VStack(spacing: 22) {
            FocusRing(progress: timer.pomodoroLeft / max(1, timer.pomodoroLength),
                      time: FocusTimer.clock(timer.pomodoroLeft), caption: timer.state.phase.label, running: running)
            HStack(spacing: 8) {
                ForEach(0..<timer.settings.roundsBeforeLongBreak, id: \.self) { i in
                    Circle()
                        .fill(i < timer.state.round % max(1, timer.settings.roundsBeforeLongBreak) || (timer.state.phase == .long && i < timer.settings.roundsBeforeLongBreak) ? Color.ink : Color.stroke)
                        .frame(width: 8, height: 8)
                }
            }
            .accessibilityLabel("Round \(timer.state.round % max(1, timer.settings.roundsBeforeLongBreak) + 1) of \(timer.settings.roundsBeforeLongBreak)")
            FocusControls(
                running: running,
                onReset: started ? { timer.resetPomodoro() } : nil,
                onToggle: { running ? timer.pausePomodoro() : timer.startPomodoro() },
                onSkip: { timer.skipPomodoro() }
            )
        }
    }
}

struct StopwatchView: View {
    @State private var timer = FocusTimer.shared

    var body: some View {
        let running = timer.state.timerRunningSince != nil
        let started = timer.state.timerStartedAt != nil
        VStack(spacing: 22) {
            FocusRing(progress: (timer.timerElapsed.truncatingRemainder(dividingBy: 3600)) / 3600,
                      time: FocusTimer.clock(timer.timerElapsed), caption: "Timer", running: running)
            FocusControls(
                running: running,
                onReset: nil,
                onToggle: { running ? timer.pauseTimer() : timer.startTimer() },
                onSkip: started ? { timer.stopTimer() } : nil,
                skipSymbol: "stop.fill"
            )
        }
    }
}

/// Pick tasks and a length, then a clean running screen with the tasks to tick off and a scratch pad.
struct SprintView: View {
    @State private var timer = FocusTimer.shared
    @State private var picking = false
    @State private var typed = ""
    @State private var pad = ""
    @State private var padLoaded = false
    @State private var padSave: Task<Void, Never>?

    var body: some View {
        let running = timer.state.sprint.endsAt != nil
        let started = running || timer.state.sprint.leftSeconds != nil
        VStack(spacing: 22) {
            if timer.state.sprintFinished {
                finished
            } else {
                FocusRing(progress: timer.sprintLeft / max(1, timer.sprintLength), time: FocusTimer.clock(timer.sprintLeft),
                          caption: started ? "Sprint" : "\(timer.state.sprintMinutes) minutes", running: running)
                if !started {
                    Stepper("Length", value: Binding(get: { timer.state.sprintMinutes }, set: { timer.state.sprintMinutes = $0 }), in: 5...240, step: 5)
                        .labelsHidden()
                }
                FocusControls(
                    running: running,
                    onReset: started ? { timer.finishSprint() } : nil,
                    onToggle: { running ? timer.pauseSprint() : timer.startSprint() },
                    onSkip: nil
                )
                tasks
                if started { scratchPad }
            }
        }
        .sheet(isPresented: $picking) { SprintPicker() }
    }

    private var tasks: some View {
        CardBox {
            CardHeader("Tasks", symbol: "checklist", count: timer.state.sprintTasks.count) {
                if timer.state.sprint.endsAt == nil {
                    Button { picking = true } label: { Image(systemName: "plus.circle") }
                        .foregroundStyle(Color.ink)
                        .accessibilityLabel("Pick tasks")
                }
            }
            ForEach(timer.state.sprintTasks) { t in
                HStack(spacing: 12) {
                    Button { timer.toggleSprintTask(t) } label: { StatusCircle(status: t.done ? .done : .todo) }
                        .buttonStyle(.plain)
                    Text(t.title).textStyle(.control, color: t.done ? .mutedText : .text).strikethrough(t.done)
                    Spacer()
                    if timer.state.sprint.endsAt == nil {
                        Button { timer.state.sprintTasks.removeAll { $0.id == t.id } } label: { Image(systemName: "xmark") }
                            .font(.system(size: 12)).foregroundStyle(Color.icon)
                            .accessibilityLabel("Take out of the sprint")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            if timer.state.sprint.endsAt == nil {
                HStack(spacing: 12) {
                    Image(systemName: "plus").foregroundStyle(Color.icon).frame(width: 22)
                    TextField("Add a task", text: $typed)
                        .font(.geist(.control))
                        .onSubmit(addTyped)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
        }
    }

    private var scratchPad: some View {
        CardBox {
            CardHeader("Scratch pad", symbol: "square.and.pencil")
            TextField("Anything on your mind", text: $pad, axis: .vertical)
                .font(.geist(.body))
                .lineLimit(3...)
                .padding(.horizontal, 16)
                .padding(.bottom, 14)
                .onChange(of: pad) { _, new in
                    guard padLoaded else { return }
                    padSave?.cancel()
                    padSave = Task {
                        try? await Task.sleep(for: .milliseconds(800))
                        guard !Task.isCancelled else { return }
                        await Repo.change("update_scratch_pad", ["text": .string(new)])
                    }
                }
        }
        .task {
            if let f = try? await Repo.fetch("get_focus", as: AppHome.Focus.self) { pad = f.scratchPad ?? "" }
            else { pad = Home.shared.data?.focus?.scratchPad ?? "" }
            padLoaded = true
        }
    }

    private var finished: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 54)).foregroundStyle(Color.ink)
            Text("Sprint done").textStyle(.section, medium: true, color: .ink)
            let done = timer.state.sprintTasks.filter(\.done)
            Text(done.isEmpty ? "Nothing ticked off." : "\(done.count) of \(timer.state.sprintTasks.count) done")
                .textStyle(.control, color: .mutedText)
            CardBox {
                ForEach(timer.state.sprintTasks) { t in
                    HStack(spacing: 12) {
                        StatusCircle(status: t.done ? .done : .todo)
                        Text(t.title).textStyle(.control, color: t.done ? .text : .mutedText)
                        Spacer()
                    }
                    .padding(.horizontal, 16).padding(.vertical, 10)
                }
            }
            Button("New sprint") { timer.newSprint() }
                .buttonStyle(.solid)
                .padding(.top, 8)
        }
        .padding(.top, 20)
    }

    private func addTyped() {
        let title = typed.trimmingCharacters(in: .whitespaces)
        guard !title.isEmpty else { return }
        typed = ""
        Task {
            let task = await TaskStore.shared.create(["title": .string(title), "area": .string(AppModel.shared.area.rawValue), "bucket": "today"])
            timer.state.sprintTasks.append(SprintTask(id: task.id, title: task.title, done: false))
        }
    }
}

/// Today's open tasks to pull into a sprint.
struct SprintPicker: View {
    @State private var timer = FocusTimer.shared
    @State private var store = TaskStore.shared
    @State private var picked: Set<String> = []
    @Environment(\.dismiss) private var dismiss

    private var open: [LukeTask] {
        let taken = Set(timer.state.sprintTasks.map(\.id))
        return store.sorted(store.tasks.filter { $0.bucket == .today && $0.status != .done && !taken.contains($0.id) && $0.area == AppModel.shared.area })
    }

    var body: some View {
        NavigationStack {
            List(open, selection: $picked) { t in
                VStack(alignment: .leading, spacing: 3) {
                    Text(t.title).textStyle(.control, color: .text)
                    if let p = t.project { ProjectChip(name: p.name, color: p.color) }
                }
                .cardRow()
            }
            .environment(\.editMode, .constant(.active))
            .pageBackground()
            .navigationTitle("Today")
            .navigationBarTitleDisplayMode(.inline)
            .overlay { if open.isEmpty { EmptyNote(text: "Nothing left on Today.") } }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .cancel) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", role: .confirm) {
                        timer.state.sprintTasks += open.filter { picked.contains($0.id) }.map { SprintTask(id: $0.id, title: $0.title, done: false) }
                        dismiss()
                    }
                    .disabled(picked.isEmpty)
                }
            }
            .task { await store.load() }
        }
    }
}

struct FocusSettingsSheet: View {
    @State private var timer = FocusTimer.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                stepper("Focus", \.focusMinutes, 5...120, unit: "min")
                stepper("Short break", \.shortBreakMinutes, 1...30, unit: "min")
                stepper("Long break", \.longBreakMinutes, 5...60, unit: "min")
                stepper("Rounds before a long break", \.roundsBeforeLongBreak, 2...8, unit: "")
            }
            .font(.geist(.control))
            .navigationTitle("Timer lengths")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(role: .confirm) { save(); dismiss() } } }
        }
        .presentationDetents([.medium])
    }

    private func stepper(_ label: String, _ key: WritableKeyPath<AppHome.FocusSettings, Int>, _ range: ClosedRange<Int>, unit: String) -> some View {
        Stepper(value: Binding(get: { timer.settings[keyPath: key] }, set: { timer.settings[keyPath: key] = $0 }), in: range) {
            HStack {
                Text(label)
                Spacer()
                Text("\(timer.settings[keyPath: key])\(unit.isEmpty ? "" : " \(unit)")").foregroundStyle(Color.mutedText).monospacedDigit()
            }
        }
    }

    private func save() {
        let s = timer.settings
        Task {
            await Repo.change("update_focus_settings", [
                "focusMinutes": .number(Double(s.focusMinutes)), "shortBreakMinutes": .number(Double(s.shortBreakMinutes)),
                "longBreakMinutes": .number(Double(s.longBreakMinutes)), "roundsBeforeLongBreak": .number(Double(s.roundsBeforeLongBreak)),
            ])
        }
    }
}

struct FocusStats: Codable, Sendable {
    struct DayTotal: Codable, Sendable, Hashable { var date: String; var seconds: Double }
    struct Session: Codable, Sendable, Hashable, Identifiable {
        var id: String
        var kind: String
        var label: String?
        var startedAt: String?
        var endedAt: String?
        var seconds: Double
        var day: String
    }
    var today: String
    var days: [DayTotal]
    var totalSeconds: Double
    var sessions: [Session]
}

/// Focus time per day, the total, and every session (swipe to delete, tap to change the length).
struct FocusStatsSheet: View {
    @State private var days = 7
    @State private var stats: FocusStats?
    @State private var editing: FocusStats.Session?
    @State private var minutes = 25

    var body: some View {
        NavigationStack {
            List {
                Picker("", selection: $days) {
                    Text("7 days").tag(7)
                    Text("30 days").tag(30)
                }
                .pickerStyle(.segmented)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)

                if let stats {
                    Section {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(Self.hours(stats.totalSeconds)).textStyle(.title, medium: true, color: .ink)
                            Text("Focused in the last \(days) days").textStyle(.meta, color: .mutedText)
                            Chart(stats.days, id: \.date) { d in
                                BarMark(x: .value("Day", Day.toLocal(d.date), unit: .day), y: .value("Hours", d.seconds / 3600))
                                    .foregroundStyle(d.date == stats.today ? Color.ink : Color.strokeStrong)
                                    .clipShape(.rect(cornerRadius: 3))
                            }
                            .chartXAxis {
                                AxisMarks(values: .stride(by: .day, count: days == 7 ? 1 : 7)) {
                                    AxisValueLabel(format: days == 7 ? .dateTime.weekday(.narrow) : .dateTime.day().month(.abbreviated), centered: true)
                                }
                            }
                            .chartYAxis {
                                AxisMarks(position: .trailing) { v in
                                    AxisGridLine()
                                    AxisValueLabel { if let h = v.as(Double.self) { Text(h == 0 ? "0" : "\(h.formatted(.number.precision(.fractionLength(0...1))))h") } }
                                }
                            }
                            .frame(height: 170)
                            .padding(.top, 12)
                        }
                        .padding(.vertical, 8)
                        .cardRow()
                    }
                    Section {
                        ForEach(stats.sessions.reversed()) { s in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(s.label ?? s.kind.capitalized).textStyle(.control, color: .text).lineLimit(1)
                                    Text(Day.friendly(s.day, today: stats.today) + (Stamp.date(s.endedAt).map { " · " + $0.formatted(date: .omitted, time: .shortened) } ?? ""))
                                        .textStyle(.meta, color: .mutedText)
                                }
                                Spacer()
                                Text(Self.hours(s.seconds)).textStyle(.preview, color: .subtleText).monospacedDigit()
                            }
                            .cardRow()
                            .contentShape(.rect)
                            .onTapGesture { minutes = Int(s.seconds / 60); editing = s }
                            .swipeActions {
                                Button("Delete", systemImage: "trash", role: .destructive) {
                                    self.stats?.sessions.removeAll { $0.id == s.id }
                                    Task { await Repo.change("delete_focus_session", ["id": .string(s.id)]); await load() }
                                }
                            }
                        }
                    } header: { SectionTitle(text: "Sessions") }
                } else {
                    ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .pageBackground()
            .contentMargins(.top, 0, for: .scrollContent)
            .listSectionSpacing(16)
            .navigationTitle("Stats")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: days) { await load() }
            .alert("Minutes focused", isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } })) {
                TextField("Minutes", value: $minutes, format: .number).keyboardType(.numberPad)
                Button("Save") {
                    if let s = editing {
                        Task { await Repo.change("update_focus_session", ["id": .string(s.id), "seconds": .number(Double(minutes * 60))]); await load() }
                    }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
        .presentationDetents([.large])
    }

    private func load() async {
        if let c = await Repo.cached("get_focus_stats", ["days": .number(Double(days))], as: FocusStats.self) { stats = c }
        if let f = try? await Repo.fetch("get_focus_stats", ["days": .number(Double(days))], as: FocusStats.self) { stats = f }
    }

    static func hours(_ s: Double) -> String {
        let m = Int(s / 60)
        return m >= 60 ? "\(m / 60)h \(m % 60)m" : "\(m)m"
    }
}
