import SwiftUI
import Charts

// MARK: Data (every field optional, so additions on the server never break the page)

struct HealthDay: Codable, Hashable, Sendable, Identifiable {
    struct Sleep: Codable, Hashable, Sendable {
        var minutes: Double?
        var start: String?
        var end: String?
        var deepMinutes: Double?
        var lightMinutes: Double?
        var remMinutes: Double?
        var awakeMinutes: Double?
    }
    struct Workout: Codable, Hashable, Sendable {
        /// Google's exercise type: RUNNING, STRENGTH_TRAINING, OUTDOOR_BIKE…
        var type: String?
        /// The custom name from the Fitbit app, if Luke gave one.
        var name: String?
        var minutes: Double?
        var startedAt: String?
        var calories: Double?
        var distanceMeters: Double?
    }

    var date: String
    var steps: Double?
    var distanceMeters: Double?
    /// Active zone minutes.
    var activeMinutes: Double?
    var caloriesOut: Double?
    var restingHeartRate: Double?
    var hrvMs: Double?
    var breathingRate: Double?
    /// Percent.
    var spo2: Double?
    /// °C against the personal baseline.
    var skinTempDeviation: Double?
    var vo2Max: Double?
    var sleep: Sleep?
    var workouts: [Workout]?

    var id: String { date }
}

struct HealthAnswer: Codable, Sendable {
    var configured: Bool?
    var connected: Bool?
    var lastSyncAt: String?
    var today: String?
    var timeZone: String?
    var days: [HealthDay]?

    var isConnected: Bool { configured != false && connected == true }

    /// Connected, but not a single number in the range (the server sends every day, all null, until data arrives).
    var hasAnyData: Bool { (days ?? []).contains(where: \.hasData) }
}

extension HealthDay {
    /// Anything at all was recorded this day.
    var hasData: Bool {
        let numbers = [steps, distanceMeters, activeMinutes, caloriesOut, restingHeartRate, hrvMs, breathingRate, spo2, skinTempDeviation, vo2Max]
        return numbers.contains { $0 != nil } || (sleep?.minutes ?? 0) > 0 || !(workouts ?? []).isEmpty
    }
}

/// Small pure helpers, tested.
enum HealthMath {
    /// Average of the values that are there; nil when none are (a band not worn is not a zero).
    static func average(_ values: [Double?]) -> Double? {
        let v = values.compactMap { $0 }
        return v.isEmpty ? nil : v.reduce(0, +) / Double(v.count)
    }

    /// The most recent night: sleep is filed under the day Luke woke up, so today's entry is last night.
    /// If today hasn't come in, yesterday's (the night before last); older isn't shown. `date` says which day it used.
    static func lastNight(_ days: [HealthDay], today: String) -> (sleep: HealthDay.Sleep, date: String)? {
        for date in [today, Day.add(today, days: -1)] {
            if let s = days.first(where: { $0.date == date })?.sleep, (s.minutes ?? 0) > 0 { return (s, date) }
        }
        return nil
    }

    /// The days labelled under a chart: every day for a week, every 7th day for a month, every 21st
    /// for 90 days, counting back from today so the newest is always labelled. Oldest first.
    static func axisDays(today: String, range: Int) -> [String] {
        let step = range <= 7 ? 1 : range <= 31 ? 7 : 21
        return stride(from: 0, to: range, by: step).map { Day.add(today, days: -$0) }.reversed()
    }

    /// Splits a day-by-day series into unbroken stretches (a day without a value ends one).
    static func runs(_ values: [(String, Double?)]) -> [(id: Int, points: [(String, Double)])] {
        var out: [(id: Int, points: [(String, Double)])] = []
        var current: [(String, Double)] = []
        for (date, value) in values {
            if let value { current.append((date, value)) } else if !current.isEmpty { out.append((out.count, current)); current = [] }
        }
        if !current.isEmpty { out.append((out.count, current)) }
        return out
    }

    /// A workout's title: the name Luke gave it, else Google's type made readable
    /// ("STRENGTH_TRAINING" → "Strength training", "HIIT" stays, "run" → "Run").
    static func workoutTitle(_ w: HealthDay.Workout) -> String {
        if let n = w.name?.trimmingCharacters(in: .whitespaces), !n.isEmpty { return n }
        return tidy(w.type ?? "")
    }

    private static let acronyms: Set<String> = ["HIIT", "SUP", "VO2"]

    static func tidy(_ raw: String) -> String {
        let words = raw.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ")
            .split(separator: " ").map(String.init)
        guard !words.isEmpty else { return "Workout" }
        let joined = words.joined(separator: " ")
        // Mixed case was written by a person: keep it.
        guard joined == joined.uppercased() || joined == joined.lowercased() else { return joined }
        return words.enumerated().map { i, w in
            if acronyms.contains(w.uppercased()) { return w.uppercased() }
            let lower = w.lowercased()
            return i == 0 ? lower.prefix(1).uppercased() + lower.dropFirst() : lower
        }.joined(separator: " ")
    }

    /// An SF Symbol for a workout type (matched on the lowercased raw type).
    static func workoutSymbol(_ type: String?) -> String {
        let t = (type ?? "").lowercased()
        let table: [(keys: [String], symbol: String)] = [
            (["hiit", "interval"], "figure.highintensity.intervaltraining"),
            (["elliptical"], "figure.elliptical"),
            (["hik"], "figure.hiking"),
            (["run", "jog"], "figure.run"),
            (["walk"], "figure.walk"),
            (["bike", "bik", "cycl", "spin"], "figure.outdoor.cycle"),
            (["swim"], "figure.pool.swim"),
            (["row"], "figure.rower"),
            (["strength", "weight"], "dumbbell"),
            (["yoga"], "figure.yoga"),
            (["pilates"], "figure.pilates"),
            (["tennis"], "figure.tennis"),
            (["soccer", "football"], "figure.soccer"),
            (["basketball"], "figure.basketball"),
            (["golf"], "figure.golf"),
            (["dance"], "figure.dance"),
        ]
        return table.first { $0.keys.contains { t.contains($0) } }?.symbol ?? "figure.mixed.cardio"
    }

    static func miles(_ meters: Double) -> String {
        let mi = meters / 1609.344
        return mi < 10 ? String(format: "%.1f mi", mi) : String(format: "%.0f mi", mi)
    }

    /// "7h 12m"
    static func hm(_ minutes: Double) -> String {
        let m = Int(minutes.rounded())
        return m >= 60 ? "\(m / 60)h \(m % 60)m" : "\(m)m"
    }

    /// Skin temperature against baseline in °F, signed: "+0.5°F".
    static func skinTemp(_ celsius: Double) -> String {
        let f = (celsius * 1.8 * 10).rounded() / 10
        if f == 0 { return "0.0°F" }
        return String(format: "%@%.1f°F", f > 0 ? "+" : "−", abs(f))
    }
}

// MARK: Screen

/// Health from Luke's Fitbit (through Google Health): last night's sleep, today's numbers, the body
/// measurements there are, charts for the last week or month, and recent workouts.
struct HealthScreen: View {
    @State private var data: HealthAnswer?
    @State private var range = 7
    @State private var syncing = false
    @State private var confirmDisconnect = false
    @State private var offline = false
    @State private var openTile: HealthSection?

    private var allDays: [HealthDay] { data?.days ?? [] }
    private var today: String { data?.today ?? AppModel.shared.today }
    private var days: [HealthDay] { Array(allDays.suffix(range)) }
    private var todayData: HealthDay? { allDays.first { $0.date == today } }
    /// The Today tiles always compare with the last week, whatever the range below says.
    private var lastWeek: [HealthDay] { Array(allDays.suffix(7)) }

    /// Demo screenshots can open other states: `-healthState notconfigured` or `-healthState gaps`.
    private var input: Input {
        var i: Input = ["days": 30]
        let args = ProcessInfo.processInfo.arguments
        if SharedConfig.isDemo, let k = args.firstIndex(of: "-healthState"), k + 1 < args.count { i["demoState"] = .string(args[k + 1]) }
        return i
    }

    var body: some View {
        List {
            if let data, !data.isConnected {
                // Google won't sign in inside an app's web view, so connecting is done once on the computer.
                EmptyNote(text: "Connect Fitbit on your computer.", symbol: "heart.text.square").listRowBackground(Color.clear)
            } else if let data {
                if !data.hasAnyData {
                    EmptyNote(text: "No data yet.", symbol: "heart.text.square").listRowBackground(Color.clear)
                } else {
                    content
                }
            } else if offline {
                EmptyNote(text: "You're offline.", symbol: "wifi.slash").listRowBackground(Color.clear)
            } else {
                DelayedSpinner().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .pageBackground()
        .navigationTitle("Health")
        .toolbar {
            if data?.isConnected == true {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Update now", systemImage: "arrow.clockwise") { Task { await sync() } }
                        Button("Disconnect Fitbit", systemImage: "link.badge.minus", role: .destructive) { confirmDisconnect = true }
                    } label: {
                        if syncing { ProgressView() } else { Image(systemName: "ellipsis") }
                    }
                    .accessibilityLabel("Health options")
                }
            }
        }
        .navigationDestination(item: $openTile) { HealthSectionScreen(section: $0) }
        .refreshable { await load() }
        .task { await load() }
        .confirmationDialog("Disconnect Fitbit?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) {
                Task { await disconnect() }
            }
        } message: {
            Text("You'll need your computer to connect again.")
        }
    }

    @ViewBuilder
    private var content: some View {
        let night = HealthMath.lastNight(allDays, today: today)
        Section {
            NavigationLink(value: MoreRoute.healthSection(HealthSection.sleep.rawValue, date: night?.date)) { sleepCard(night?.sleep) }.cardRow()
        } header: {
            SectionTitle(text: night == nil || night?.date == today ? "Last night" : "Sleep · Yesterday")
        }
        Section {
            todayGrid.listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
        } header: { SectionTitle(text: "Today") }
        Section {
            Picker("Range", selection: $range) {
                Text("7 days").tag(7)
                Text("30 days").tag(30)
            }
            .pickerStyle(.segmented)
            .controlRow()
        }
        if !bodyRows.isEmpty {
            Section {
                ForEach(bodyRows, id: \.title) { row in
                    NavigationLink(value: MoreRoute.healthSection(row.section.rawValue)) {
                    HStack(spacing: Space.m) {
                        Image(systemName: row.symbol).font(.icon(.row)).foregroundStyle(Color.icon).frame(width: Size.iconColumn)
                        Text(row.title).textStyle(.control, color: .text)
                        Spacer()
                        VStack(alignment: .trailing, spacing: Space.xs) {
                            Text(row.latest).textStyle(.control, medium: true, color: .ink).monospacedDigit()
                            if let a = row.average { Text("avg \(a)").textStyle(.tag, color: .mutedText).monospacedDigit() }
                        }
                    }
                    }
                    .cardRow()
                    .accessibilityElement(children: .combine)
                }
            } header: { SectionTitle(text: "Body") }
        }
        Section {
            link(.sleep) { barChart("Sleep", values: days.map { ($0.date, $0.sleep?.minutes.map { $0 / 60 }) }) { String(format: "%.1fh", $0) } }
        } header: { SectionTitle(text: "Sleep") }
        Section {
            link(.steps) { barChart("Steps", values: days.map { ($0.date, $0.steps) }) { $0.formatted(.number.notation(.compactName)) } }
        } header: { SectionTitle(text: "Steps") }
        if days.contains(where: { $0.restingHeartRate != nil }) {
            Section { link(.heartRate) { heartChart } } header: { SectionTitle(text: "Resting heart rate") }
        }
        let workouts = Array(allDays.reversed().flatMap { d in (d.workouts ?? []).map { (d.date, $0) } }.prefix(8))
        if !workouts.isEmpty {
            Section {
                ForEach(Array(workouts.enumerated()), id: \.offset) { _, item in
                    NavigationLink(value: MoreRoute.workout(HealthWorkoutRef(date: item.0, workout: item.1, today: today, timeZone: data?.timeZone))) {
                        workoutRow(item.0, item.1)
                    }
                    .cardRow()
                }
            } header: { SectionTitle(text: "Workouts") }
        }
        if let updated = HealthDetailMath.updated(data?.lastSyncAt, today: data?.today, timeZone: data?.timeZone.flatMap(TimeZone.init(identifier:)) ?? .current) {
            Text("From Fitbit · \(updated)")
                .textStyle(.meta, color: .mutedText)
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
        }
    }

    // MARK: Loading

    private func load() async {
        if data == nil, let c = await Repo.cached("get_health", input, as: HealthAnswer.self) { data = c }
        do {
            let fresh = try await Repo.fetch("get_health", input, as: HealthAnswer.self)
            withAnimation(Motion.snappy) { data = fresh }
            offline = false
        } catch {
            offline = data == nil
        }
    }

    struct SyncAnswer: Decodable { var synced: Bool?; var lastSyncAt: String? }

    /// Sent now or not at all: a queued sync is pointless and a queued disconnect could fire later by itself.
    private func sync() async {
        syncing = true
        defer { syncing = false }
        do {
            _ = try await Repo.api.op("sync_health", [:], as: SyncAnswer.self, timeout: LukeAPI.longTimeout)
            await load()
        } catch { failed(error) }
    }

    private func disconnect() async {
        do {
            _ = try await Repo.api.opData("disconnect_health")
            await load()
        } catch { failed(error) }
    }

    private func failed(_ error: Error) {
        switch error {
        case APIError.offline: Toasts.shared.show("You're offline.")
        case APIError.signedOut: NotificationCenter.default.post(name: .lukeOSSignedOut, object: nil)
        default: Toasts.shared.show(error.localizedDescription)
        }
    }

    // MARK: Pieces

    private func sleepCard(_ sleep: HealthDay.Sleep?) -> some View {
        VStack(alignment: .leading, spacing: Space.m) {
            if let s = sleep, let minutes = s.minutes {
                HStack(alignment: .firstTextBaseline) {
                    Text(HealthMath.hm(minutes)).textStyle(.title, medium: true, color: .ink).rollingNumber(Int(minutes))
                    Spacer()
                    if let a = Stamp.date(s.start), let b = Stamp.date(s.end) {
                        Text("\(clock(a)) – \(clock(b))").textStyle(.meta, color: .mutedText)
                    }
                }
                stagesBar(s)
                HStack(spacing: Space.l) {
                    stage("Deep", s.deepMinutes, .ink)
                    stage("REM", s.remMinutes, .subtleText)
                    stage("Light", s.lightMinutes, .strokeStrong)
                    stage("Awake", s.awakeMinutes, .stroke)
                }
            } else {
                Text("No sleep recorded.").textStyle(.control, color: .mutedText)
            }
        }
        .padding(.vertical, Space.s)
        .accessibilityElement(children: .combine)
    }

    /// A time of day in Luke's time zone (the server's), e.g. "11:04 PM".
    private func clock(_ d: Date) -> String {
        var f = Date.FormatStyle(date: .omitted, time: .shortened)
        if let tz = data?.timeZone.flatMap(TimeZone.init(identifier:)) { f.timeZone = tz }
        return d.formatted(f)
    }

    private func stagesBar(_ s: HealthDay.Sleep) -> some View {
        let parts: [(Double, Color)] = [(s.deepMinutes ?? 0, .ink), (s.remMinutes ?? 0, .subtleText), (s.lightMinutes ?? 0, .strokeStrong), (s.awakeMinutes ?? 0, .stroke)]
        let total = max(1, parts.reduce(0) { $0 + $1.0 })
        return GeometryReader { geo in
            HStack(spacing: 2) {
                ForEach(Array(parts.enumerated()), id: \.offset) { _, p in
                    if p.0 > 0 {
                        RoundedRectangle(cornerRadius: Radius.tag / 2).fill(p.1)
                            .frame(width: max(2, (geo.size.width - 6) * p.0 / total))
                    }
                }
            }
        }
        .frame(height: Space.m)
        .accessibilityHidden(true)
    }

    private func stage(_ name: String, _ minutes: Double?, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            HStack(spacing: Space.xs) {
                Circle().fill(color).frame(width: Size.unreadDot, height: Size.unreadDot)
                Text(name).textStyle(.tag, color: .mutedText)
            }
            Text(minutes.map(HealthMath.hm) ?? "–").textStyle(.preview, medium: true, color: .text).monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }

    private var todayGrid: some View {
        let d = todayData
        let week = lastWeek
        return Grid(horizontalSpacing: Space.m, verticalSpacing: Space.m) {
            GridRow {
                tileLink(.steps, StatTile(title: "Steps", symbol: "figure.walk", value: d?.steps.map { Int($0).formatted() },
                         detail: HealthMath.average(week.map(\.steps)).map { "7-day avg \(Int($0).formatted())" }))
                tileLink(.heartRate, StatTile(title: "Resting heart", symbol: "heart", value: d?.restingHeartRate.map { "\(Int($0)) bpm" },
                         detail: HealthMath.average(week.map(\.restingHeartRate)).map { "7-day avg \(Int($0.rounded()))" }))
            }
            GridRow {
                tileLink(.activeZoneMinutes, StatTile(title: "Active zone", symbol: "flame", value: d?.activeMinutes.map { "\(Int($0)) min" },
                         detail: HealthMath.average(week.map(\.activeMinutes)).map { "7-day avg \(Int($0.rounded()))" }))
                // Distance has no page of its own; it's walked, so it opens Steps.
                tileLink(.steps, StatTile(title: "Distance", symbol: "map", value: d?.distanceMeters.map(HealthMath.miles),
                         detail: HealthMath.average(week.map(\.distanceMeters)).map { "7-day avg \(HealthMath.miles($0))" }))
            }
        }
    }

    /// Extra daily numbers, only those with data in the range.
    private var bodyRows: [(title: String, symbol: String, latest: String, average: String?, section: HealthSection)] {
        func row(_ title: String, _ section: HealthSection, _ format: (Double) -> String) -> (String, String, String, String?, HealthSection)? {
            let values = days.map(section.value)
            guard let latest = days.last(where: { section.value($0) != nil }).flatMap(section.value) else { return nil }
            return (title, section.symbol, format(latest), HealthMath.average(values).map(format), section)
        }
        return [
            row("Breathing rate", .breathingRate) { String(format: "%.1f /min", $0) },
            row("Blood oxygen", .bloodOxygen) { String(format: "%.1f%%", $0) },
            row("HRV", .hrv) { "\(Int($0.rounded())) ms" },
            row("Skin temperature", .skinTemperature, HealthMath.skinTemp),
            row("VO2 max", .vo2Max) { String(format: "%.0f", $0) },
        ].compactMap { $0.map { (title: $0.0, symbol: $0.1, latest: $0.2, average: $0.3, section: $0.4) } }
    }

    /// A chart card that opens its section.
    private func link(_ section: HealthSection, @ViewBuilder _ content: () -> some View) -> some View {
        NavigationLink(value: MoreRoute.healthSection(section.rawValue)) { content() }
            .cardRow()
            .accessibilityHint("Opens \(section.title)")
    }

    /// A Today tile that opens its section. A plain button rather than a link, so the list doesn't add a
    /// chevron beside each tile in the grid.
    private func tileLink(_ section: HealthSection, _ tile: StatTile) -> some View {
        Button { openTile = section } label: { tile }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Opens \(section.title)")
    }


    private func barChart(_ title: String, values: [(String, Double?)], format: @escaping (Double) -> String) -> some View {
        let present = values.compactMap { v in v.1.map { (v.0, $0) } }
        let average = HealthMath.average(values.map(\.1))
        return VStack(alignment: .leading, spacing: Space.s) {
            Text(average.map { "avg \(format($0))" } ?? "No data").textStyle(.meta, color: .mutedText)
            Chart {
                ForEach(present, id: \.0) { v in
                    BarMark(x: .value("Day", Day.toLocal(v.0), unit: .day), y: .value(title, v.1))
                        .foregroundStyle(v.0 == today ? Color.ink : Color.strokeStrong)
                        .clipShape(.rect(cornerRadius: Radius.tag / 2))
                }
                if let average {
                    RuleMark(y: .value("Average", average))
                        .foregroundStyle(Color.stroke)
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }
            }
            .chartXScale(domain: chartDomain)
            .chartXAxis { dayAxis }
            .chartYAxis {
                AxisMarks(position: .trailing) { v in
                    AxisGridLine()
                    AxisValueLabel { if let n = v.as(Double.self) { Text(format(n)) } }
                }
            }
            .frame(height: Size.chartHeight)
        }
        .padding(.vertical, Space.s)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title), last \(range) days\(average.map { ", average \(format($0))" } ?? ", no data")")
    }

    /// The whole range, so days without data show as gaps rather than shifting the bars.
    private var chartDomain: ClosedRange<Date> {
        let start = Day.toLocal(Day.add(today, days: -(range - 1)))
        let end = Day.toLocal(Day.add(today, days: 1))
        return start...end
    }

    private var dayAxis: some AxisContent {
        // Marks at midday sit in the middle of each day's bar (Charts drops the last label when asked to centre it).
        // On the 30-day view the first and last dates line up with their bars' outer edges so neither is cut off.
        AxisMarks(values: HealthMath.axisDays(today: today, range: range).map { Day.toLocal($0).addingTimeInterval(12 * 3600) }) { value in
            let anchor: UnitPoint = range <= 7 ? .top : value.index == 0 ? .topLeading : value.index == value.count - 1 ? .topTrailing : .top
            AxisValueLabel(format: range == 7 ? .dateTime.weekday(.narrow) : .dateTime.day().month(.abbreviated),
                           centered: false, anchor: anchor)
        }
    }

    private var heartChart: some View {
        let runs = HealthMath.runs(days.map { ($0.date, $0.restingHeartRate) })
        let points = runs.flatMap { r in r.points.map { (date: $0.0, value: $0.1, run: r.id) } }
        let low = (points.map(\.value).min() ?? 50) - 3
        let high = (points.map(\.value).max() ?? 70) + 3
        return Chart(points, id: \.date) { p in
            // One line per unbroken stretch, so days without data are gaps, as in the bar charts.
            LineMark(x: .value("Day", Day.toLocal(p.date), unit: .day), y: .value("bpm", p.value), series: .value("Stretch", p.run))
                .foregroundStyle(Color.ink)
                .interpolationMethod(.monotone)
            PointMark(x: .value("Day", Day.toLocal(p.date), unit: .day), y: .value("bpm", p.value))
                .foregroundStyle(Color.ink)
                .symbolSize(range == 7 ? 24 : 8)
        }
        .chartXScale(domain: chartDomain)
        .chartYScale(domain: low...high)
        .chartXAxis { dayAxis }
        .chartYAxis { AxisMarks(position: .trailing) { AxisGridLine(); AxisValueLabel() } }
        .frame(height: Size.chartHeight)
        .padding(.vertical, Space.s)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Resting heart rate, last \(range) days\(HealthMath.average(points.map { Optional($0.value) }).map { ", average \(Int($0.rounded())) beats per minute" } ?? "")")
    }

    private func workoutRow(_ date: String, _ w: HealthDay.Workout) -> some View {
        let detail = [w.distanceMeters.map(HealthMath.miles), w.calories.map { "\(Int($0)) cal" }].compactMap { $0 }
        return HStack(spacing: Space.m) {
            Image(systemName: HealthMath.workoutSymbol(w.type)).font(.icon(.row)).foregroundStyle(Color.icon).frame(width: Size.iconColumn)
            VStack(alignment: .leading, spacing: Space.xs) {
                Text(HealthMath.workoutTitle(w)).textStyle(.control, color: .text)
                Text(([Day.friendly(date, today: today)] + detail).joined(separator: " · ")).textStyle(.meta, color: .mutedText)
            }
            Spacer()
            if let m = w.minutes { Text("\(Int(m)) min").textStyle(.preview, color: .subtleText).monospacedDigit() }
        }
        .accessibilityElement(children: .combine)
    }
}
