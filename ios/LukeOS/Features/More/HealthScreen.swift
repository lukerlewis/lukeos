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
        var type: String?
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
}

/// Small pure helpers, tested.
enum HealthMath {
    /// Average of the values that are there; nil when none are (a band not worn is not a zero).
    static func average(_ values: [Double?]) -> Double? {
        let v = values.compactMap { $0 }
        return v.isEmpty ? nil : v.reduce(0, +) / Double(v.count)
    }

    /// Last night's sleep: the sleep filed under the server's today, else under yesterday. Older sleep isn't "last night".
    static func lastNight(_ days: [HealthDay], today: String) -> HealthDay.Sleep? {
        if let s = days.first(where: { $0.date == today })?.sleep, (s.minutes ?? 0) > 0 { return s }
        if let s = days.first(where: { $0.date == Day.add(today, days: -1) })?.sleep, (s.minutes ?? 0) > 0 { return s }
        return nil
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
        let f = celsius * 1.8
        return String(format: "%@%.1f°F", f >= 0 ? "+" : "−", abs(f))
    }
}

// MARK: Screen

/// Health from Luke's Fitbit (through Google Health): last night's sleep, today's numbers, the body
/// measurements there are, charts for the last week or month, and recent workouts.
struct HealthScreen: View {
    @State private var data: HealthAnswer?
    @State private var range = 7
    @State private var connecting = false
    @State private var syncing = false
    @State private var confirmDisconnect = false
    @State private var offline = false

    private var allDays: [HealthDay] { data?.days ?? [] }
    private var today: String { data?.today ?? AppModel.shared.today }
    private var days: [HealthDay] { Array(allDays.suffix(range)) }
    private var todayData: HealthDay? { allDays.first { $0.date == today } }

    /// Demo screenshots can open the not-connected state with `-healthState notconfigured`.
    private var input: Input {
        var i: Input = ["days": 30]
        let args = ProcessInfo.processInfo.arguments
        if SharedConfig.isDemo, let k = args.firstIndex(of: "-healthState"), k + 1 < args.count { i["demoState"] = .string(args[k + 1]) }
        return i
    }

    var body: some View {
        List {
            if let data, !data.isConnected {
                connectRow
            } else if let data {
                if (data.days ?? []).isEmpty {
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
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $connecting, onDismiss: { Task { await load() } }) {
            WebSheet(path: "/health/connect", title: "Connect Fitbit", closeOn: "/health/connected")
        }
        .confirmationDialog("Disconnect Fitbit?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) {
                Task {
                    await Repo.change("disconnect_health", [:])
                    await load()
                }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        Section { sleepCard.cardRow() } header: { SectionTitle(text: "Last night") }
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
                    HStack(spacing: Space.m) {
                        Image(systemName: row.symbol).font(.icon(.row)).foregroundStyle(Color.icon).frame(width: Size.iconColumn)
                        Text(row.title).textStyle(.control, color: .text)
                        Spacer()
                        VStack(alignment: .trailing, spacing: Space.xs) {
                            Text(row.latest).textStyle(.control, medium: true, color: .ink).monospacedDigit()
                            if let a = row.average { Text("avg \(a)").textStyle(.tag, color: .mutedText).monospacedDigit() }
                        }
                    }
                    .cardRow()
                    .accessibilityElement(children: .combine)
                }
            } header: { SectionTitle(text: "Body") }
        }
        Section {
            barChart("Sleep", values: days.map { ($0.date, $0.sleep?.minutes.map { $0 / 60 }) }) { String(format: "%.1fh", $0) }.cardRow()
        } header: { SectionTitle(text: "Sleep") }
        Section {
            barChart("Steps", values: days.map { ($0.date, $0.steps) }) { $0.formatted(.number.notation(.compactName)) }.cardRow()
        } header: { SectionTitle(text: "Steps") }
        if days.contains(where: { $0.restingHeartRate != nil }) {
            Section { heartChart.cardRow() } header: { SectionTitle(text: "Resting heart rate") }
        }
        let workouts = Array(allDays.reversed().flatMap { d in (d.workouts ?? []).map { (d.date, $0) } }.prefix(8))
        if !workouts.isEmpty {
            Section {
                ForEach(Array(workouts.enumerated()), id: \.offset) { _, item in workoutRow(item.0, item.1).cardRow() }
            } header: { SectionTitle(text: "Workouts") }
        }
        if let sync = data?.lastSyncAt {
            Text("From Fitbit · updated \(Stamp.relative(sync))")
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

    private func sync() async {
        syncing = true
        defer { syncing = false }
        await Repo.change("sync_health", [:])
        await load()
    }

    // MARK: Pieces

    private var connectRow: some View {
        Button { connecting = true } label: {
            HStack(spacing: Space.m) {
                Image(systemName: "heart.text.square").font(.icon(.row)).foregroundStyle(Color.icon).frame(width: Size.iconColumn)
                Text("Connect Fitbit").textStyle(.control, color: .text)
                Spacer()
                Image(systemName: "chevron.right").font(.icon(.meta)).foregroundStyle(Color.icon)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .cardRow()
    }

    private var sleepCard: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            if let s = HealthMath.lastNight(allDays, today: today), let minutes = s.minutes {
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
        return Grid(horizontalSpacing: Space.m, verticalSpacing: Space.m) {
            GridRow {
                tile("Steps", d?.steps.map { Int($0).formatted() }, "figure.walk",
                     average: HealthMath.average(days.map(\.steps)).map { "avg \(Int($0).formatted())" })
                tile("Resting heart", d?.restingHeartRate.map { "\(Int($0)) bpm" }, "heart",
                     average: HealthMath.average(days.map(\.restingHeartRate)).map { "avg \(Int($0.rounded()))" })
            }
            GridRow {
                tile("Active zone", d?.activeMinutes.map { "\(Int($0)) min" }, "flame",
                     average: HealthMath.average(days.map(\.activeMinutes)).map { "avg \(Int($0.rounded()))" })
                tile("Distance", d?.distanceMeters.map(HealthMath.miles), "map",
                     average: HealthMath.average(days.map(\.distanceMeters)).map { "avg \(HealthMath.miles($0))" })
            }
        }
    }

    private func tile(_ title: String, _ value: String?, _ symbol: String, average: String?) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            HStack(spacing: Space.xs) {
                Image(systemName: symbol).font(.icon(.meta)).foregroundStyle(Color.icon)
                Text(title).textStyle(.meta, color: .mutedText)
            }
            Text(value ?? "–").textStyle(.section, medium: true, color: .ink).monospacedDigit()
            Text(average ?? " ").textStyle(.tag, color: .mutedText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Space.l)
        .background(Color.card, in: .rect(cornerRadius: Radius.card))
        .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Color.hairline, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title), \(value ?? "no data")\(average.map { ", \($0)" } ?? "")")
    }

    /// Extra daily numbers, only those with data in the range.
    private var bodyRows: [(title: String, symbol: String, latest: String, average: String?)] {
        func row(_ title: String, _ symbol: String, _ key: KeyPath<HealthDay, Double?>, _ format: (Double) -> String) -> (String, String, String, String?)? {
            let values = days.map { $0[keyPath: key] }
            guard let latest = days.last(where: { $0[keyPath: key] != nil })?[keyPath: key] else { return nil }
            return (title, symbol, format(latest), HealthMath.average(values).map(format))
        }
        return [
            row("Breathing rate", "lungs", \.breathingRate) { String(format: "%.1f /min", $0) },
            row("Blood oxygen", "drop", \.spo2) { String(format: "%.1f%%", $0) },
            row("HRV", "waveform.path.ecg", \.hrvMs) { "\(Int($0.rounded())) ms" },
            row("Skin temperature", "thermometer.medium", \.skinTempDeviation, HealthMath.skinTemp),
            row("VO2 max", "figure.run", \.vo2Max) { String(format: "%.0f", $0) },
        ].compactMap { $0.map { (title: $0.0, symbol: $0.1, latest: $0.2, average: $0.3) } }
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
        AxisMarks(values: .stride(by: .day, count: range == 7 ? 1 : 7)) {
            AxisValueLabel(format: range == 7 ? .dateTime.weekday(.narrow) : .dateTime.day().month(.abbreviated), centered: true)
        }
    }

    private var heartChart: some View {
        let points = days.compactMap { d in d.restingHeartRate.map { (d.date, $0) } }
        let low = (points.map(\.1).min() ?? 50) - 3
        let high = (points.map(\.1).max() ?? 70) + 3
        return Chart(points, id: \.0) { p in
            LineMark(x: .value("Day", Day.toLocal(p.0), unit: .day), y: .value("bpm", p.1))
                .foregroundStyle(Color.ink)
                .interpolationMethod(.monotone)
            PointMark(x: .value("Day", Day.toLocal(p.0), unit: .day), y: .value("bpm", p.1))
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
        .accessibilityLabel("Resting heart rate, last \(range) days\(HealthMath.average(points.map { Optional($0.1) }).map { ", average \(Int($0.rounded())) beats per minute" } ?? "")")
    }

    private func workoutRow(_ date: String, _ w: HealthDay.Workout) -> some View {
        let detail = [w.distanceMeters.map(HealthMath.miles), w.calories.map { "\(Int($0)) cal" }].compactMap { $0 }
        return HStack(spacing: Space.m) {
            Image(systemName: symbol(w.type ?? "")).font(.icon(.row)).foregroundStyle(Color.icon).frame(width: Size.iconColumn)
            VStack(alignment: .leading, spacing: Space.xs) {
                Text(w.type ?? "Workout").textStyle(.control, color: .text)
                Text(([Day.friendly(date, today: today)] + detail).joined(separator: " · ")).textStyle(.meta, color: .mutedText)
            }
            Spacer()
            if let m = w.minutes { Text("\(Int(m)) min").textStyle(.preview, color: .subtleText).monospacedDigit() }
        }
        .accessibilityElement(children: .combine)
    }

    private func symbol(_ type: String) -> String {
        let t = type.lowercased()
        if t.contains("run") { return "figure.run" }
        if t.contains("walk") || t.contains("hike") { return "figure.walk" }
        if t.contains("bike") || t.contains("cycl") { return "figure.outdoor.cycle" }
        if t.contains("swim") { return "figure.pool.swim" }
        if t.contains("strength") || t.contains("weight") { return "dumbbell" }
        if t.contains("yoga") { return "figure.yoga" }
        return "figure.mixed.cardio"
    }
}
