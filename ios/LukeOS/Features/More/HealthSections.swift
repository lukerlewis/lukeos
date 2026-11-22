import SwiftUI

// MARK: Sections Luke can tap into (the website's src/lib/health-sections.ts)

/// One number on the Health page with a page of its own: a chart over 7, 30 or 90 days, its stats,
/// every day as a list and, for some, the picked day in detail (`get_health_day`).
enum HealthSection: String, CaseIterable, Hashable, Sendable, Identifiable {
    case sleep
    case steps
    case heartRate = "heart-rate"
    case hrv
    case activeZoneMinutes = "active-zone-minutes"
    case breathingRate = "breathing-rate"
    case bloodOxygen = "blood-oxygen"
    case skinTemperature = "skin-temperature"
    case vo2Max = "vo2-max"

    enum Chart { case bar, line }
    /// Which within-the-day detail the picked day shows.
    enum DayDetail { case sleep, steps, heart }

    var id: String { rawValue }

    var title: String {
        switch self {
        case .sleep: "Sleep"
        case .steps: "Steps"
        case .heartRate: "Resting heart rate"
        case .hrv: "Heart rate variability"
        case .activeZoneMinutes: "Active zone minutes"
        case .breathingRate: "Breathing rate"
        case .bloodOxygen: "Blood oxygen"
        case .skinTemperature: "Skin temperature"
        case .vo2Max: "Cardio fitness (VO₂ max)"
        }
    }

    var symbol: String {
        switch self {
        case .sleep: "bed.double"
        case .steps: "figure.walk"
        case .heartRate: "heart"
        case .hrv: "waveform.path.ecg"
        case .activeZoneMinutes: "flame"
        case .breathingRate: "lungs"
        case .bloodOxygen: "drop"
        case .skinTemperature: "thermometer.medium"
        case .vo2Max: "figure.run"
        }
    }

    func value(_ d: HealthDay) -> Double? {
        switch self {
        case .sleep: d.sleep?.minutes
        case .steps: d.steps
        case .heartRate: d.restingHeartRate
        case .hrv: d.hrvMs
        case .activeZoneMinutes: d.activeMinutes
        case .breathingRate: d.breathingRate
        case .bloodOxygen: d.spo2
        case .skinTemperature: d.skinTempDeviation
        case .vo2Max: d.vo2Max
        }
    }

    func format(_ v: Double) -> String {
        switch self {
        case .sleep: HealthMath.hm(v)
        case .steps: Int(v.rounded()).formatted()
        case .heartRate: "\(Int(v.rounded())) bpm"
        case .hrv: "\(Int(v.rounded())) ms"
        case .activeZoneMinutes: "\(Int(v.rounded())) min"
        case .breathingRate: String(format: "%.1f /min", v)
        case .bloodOxygen: String(format: "%.1f%%", v)
        case .skinTemperature: HealthMath.skinTemp(v)
        case .vo2Max: String(format: "%.1f", v)
        }
    }

    var chart: Chart {
        switch self {
        case .sleep, .steps, .activeZoneMinutes: .bar
        default: .line
        }
    }

    /// Adding days up means something (steps, minutes), so there's a Total.
    var adds: Bool { self == .steps || self == .activeZoneMinutes }

    var dayDetail: DayDetail? {
        switch self {
        case .sleep: .sleep
        case .steps: .steps
        case .heartRate, .activeZoneMinutes: .heart
        default: nil
        }
    }

    /// The number drawn on the chart: sleep in hours, skin temperature in °F against baseline.
    func plotted(_ v: Double) -> Double {
        switch self {
        case .sleep: v / 60
        case .skinTemperature: v * 1.8
        default: v
        }
    }

    /// A chart axis label for a plotted number.
    func tick(_ v: Double) -> String {
        switch self {
        case .sleep: String(format: "%.0fh", v)
        case .steps: v >= 1000 ? "\(Int((v / 1000).rounded()))k" : "\(Int(v))"
        case .skinTemperature: v == 0 ? "0" : String(format: "%+.1f", v)
        case .breathingRate, .vo2Max: v.rounded() == v ? "\(Int(v))" : String(format: "%.1f", v)
        default: "\(Int(v.rounded()))"
        }
    }

    var goal: Double? { self == .steps ? 10_000 : nil }
}

/// Where Health's links go (pushed onto More's stack).
struct HealthWorkoutRef: Hashable, Sendable {
    var date: String
    var workout: HealthDay.Workout
    var today: String
    var timeZone: String?
}

// MARK: One day in detail (`get_health_day`)

struct HealthDayDetail: Codable, Sendable {
    struct HeartPoint: Codable, Hashable, Sendable {
        var time: String?
        var bpm: Double?
        var min: Double?
        var max: Double?
    }
    struct Stage: Codable, Hashable, Sendable {
        /// AWAKE, LIGHT, DEEP, REM; ASLEEP and RESTLESS for classic nights.
        var stage: String?
        var start: String?
        var end: String?
    }

    var date: String?
    var sleep: HealthDay.Sleep?
    /// 24 numbers from local midnight; null when nothing was recorded that hour.
    var stepsByHour: [Double?]?
    /// 5-minute buckets.
    var heartRate: [HeartPoint]?
    /// Every part of the night that ended that morning (it can be split in two with a gap).
    var sleepStages: [Stage]?
}

/// A heart-rate bucket with its time read.
struct HeartSample: Hashable, Sendable {
    var time: Date
    var bpm: Double
    var min: Double
    var max: Double
}

/// A stretch of one sleep stage, with its times read.
struct SleepSpan: Hashable, Sendable {
    var stage: String
    var start: Date
    var end: Date
    var minutes: Double { end.timeIntervalSince(start) / 60 }
}

/// Pure helpers for the section pages, tested.
enum HealthDetailMath {
    struct Stat: Hashable { var label: String; var value: Double }

    /// Average, Lowest, Highest (and Total when adding up means something) of the days that have a value.
    static func stats(_ values: [Double?], total: Bool) -> [Stat] {
        let v = values.compactMap { $0 }
        guard !v.isEmpty else { return [] }
        var out = [Stat(label: "Average", value: v.reduce(0, +) / Double(v.count)),
                   Stat(label: "Lowest", value: v.min()!),
                   Stat(label: "Highest", value: v.max()!)]
        if total { out.append(Stat(label: "Total", value: v.reduce(0, +))) }
        return out
    }

    /// The day picked when a page opens: the asked-for day if it's in range, else the newest with a value, else the newest.
    static func initialPick(_ days: [HealthDay], section: HealthSection, asked: String?) -> String? {
        if let asked, days.contains(where: { $0.date == asked }) { return asked }
        return days.last(where: { section.value($0) != nil })?.date ?? days.last?.date
    }

    /// The day before or after `date` in the range (for VoiceOver's swipe up and down), or nil at an end.
    static func step(_ days: [HealthDay], from date: String, by n: Int) -> String? {
        guard let i = days.firstIndex(where: { $0.date == date }), days.indices.contains(i + n) else { return nil }
        return days[i + n].date
    }

    /// The hour with the most steps, or nil when no steps were recorded.
    static func busiestHour(_ hours: [Double?]) -> Int? {
        let best = hours.enumerated().max { ($0.element ?? 0) < ($1.element ?? 0) }
        guard let best, (best.element ?? 0) > 0 else { return nil }
        return best.offset
    }

    /// "12a", "6a", "12p", "6p" for chart axes.
    static func hourLabel(_ h: Int) -> String {
        let h = ((h % 24) + 24) % 24
        return h == 0 ? "12a" : h == 12 ? "12p" : h < 12 ? "\(h)a" : "\(h - 12)p"
    }

    /// "6–7 PM", "11 AM–12 PM", "11 PM–12 AM".
    static func hourRange(_ h: Int) -> String {
        func parts(_ h: Int) -> (Int, String) {
            let h = h % 24
            return (h % 12 == 0 ? 12 : h % 12, h < 12 ? "AM" : "PM")
        }
        let (a, am) = parts(h), (b, bm) = parts(h + 1)
        return am == bm ? "\(a)–\(b) \(bm)" : "\(a) \(am)–\(b) \(bm)"
    }

    /// Heart-rate buckets as times, in order, dropping any the server sent incomplete.
    static func heartSamples(_ points: [HealthDayDetail.HeartPoint]) -> [HeartSample] {
        points.compactMap { p in
            guard let t = Stamp.date(p.time), let bpm = p.bpm else { return nil }
            return HeartSample(time: t, bpm: bpm, min: p.min ?? bpm, max: p.max ?? bpm)
        }.sorted { $0.time < $1.time }
    }

    /// Splits samples where the watch was off for more than `maxGap`, so the line breaks there.
    static func runs(_ samples: [HeartSample], maxGap: TimeInterval = 20 * 60) -> [[HeartSample]] {
        var out: [[HeartSample]] = []
        for s in samples {
            if let last = out.last?.last, s.time.timeIntervalSince(last.time) <= maxGap { out[out.count - 1].append(s) } else { out.append([s]) }
        }
        return out
    }

    static func sleepSpans(_ stages: [HealthDayDetail.Stage]) -> [SleepSpan] {
        stages.compactMap { s in
            guard let st = s.stage?.uppercased(), let a = Stamp.date(s.start), let b = Stamp.date(s.end), b > a else { return nil }
            return SleepSpan(stage: st, start: a, end: b)
        }.sorted { $0.start < $1.start }
    }

    /// Stage rows top to bottom, as on the website: Awake (Restless), REM, Light (Asleep), Deep; only those present.
    static let stageOrder = ["AWAKE", "RESTLESS", "REM", "LIGHT", "ASLEEP", "DEEP"]

    static func stageRows(_ spans: [SleepSpan]) -> [String] {
        let present = Set(spans.map(\.stage))
        return stageOrder.filter(present.contains) + present.subtracting(stageOrder).sorted()
    }

    static func stageName(_ stage: String) -> String {
        ["AWAKE": "Awake", "RESTLESS": "Restless", "REM": "REM", "LIGHT": "Light", "ASLEEP": "Asleep", "DEEP": "Deep"][stage]
            ?? HealthMath.tidy(stage)
    }

    /// Each stage's minutes and its share of the whole night (awake included), rounded to whole percents.
    static func stageTotals(_ spans: [SleepSpan]) -> [(stage: String, minutes: Double, percent: Int)] {
        var minutes: [String: Double] = [:]
        for s in spans { minutes[s.stage, default: 0] += s.minutes }
        let whole = max(1, minutes.values.reduce(0, +))
        return stageRows(spans).map { ($0, minutes[$0] ?? 0, Int(((minutes[$0] ?? 0) / whole * 100).rounded())) }
    }

    /// The footer under Health: "Updated just now", "Updated 2 min ago", "Updated 3 hr ago", "Updated yesterday", "Updated Fri 20 Nov".
    static func updated(_ iso: String?, now: Date = .now, today: String? = nil, timeZone: TimeZone = .current) -> String? {
        guard let d = Stamp.date(iso) else { return nil }
        let secs = max(0, now.timeIntervalSince(d))
        if secs < 60 { return "Updated just now" }
        if secs < 3600 { return "Updated \(Int(secs / 60)) min ago" }
        if secs < 12 * 3600 { return "Updated \(Int(secs / 3600)) hr ago" }
        let then = Day.today(in: timeZone, now: d)
        let now = today ?? Day.today(in: timeZone, now: now)
        if then == now { return "Updated \(Int(secs / 3600)) hr ago" }
        if Day.add(now, days: -1) == then { return "Updated yesterday" }
        return "Updated \(Day.friendly(then, today: now))"
    }

    /// Local midnight at the start of `day` in a time zone, and the next one.
    static func dayBounds(_ day: String, timeZone: TimeZone) -> ClosedRange<Date> {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let p = day.split(separator: "-").compactMap { Int($0) }
        let start = p.count == 3 ? cal.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) ?? .now : .now
        return start...(cal.date(byAdding: .day, value: 1, to: start) ?? start.addingTimeInterval(86_400))
    }
}

// MARK: The day-detail cache

/// `get_health_day` answers, kept per date while the app runs (and on disk through Repo for offline).
@MainActor @Observable
final class HealthDayStore {
    static let shared = HealthDayStore()

    private(set) var details: [String: HealthDayDetail] = [:]
    private(set) var errors: [String: String] = [:]
    /// Dates fetched from the server this run; the saved copy alone is fetched again.
    private var fresh: Set<String> = []
    private var loading: Set<String> = []

    func load(_ date: String, force: Bool = false) async {
        if force { fresh.remove(date) }
        guard !fresh.contains(date), !loading.contains(date) else { return }
        loading.insert(date)
        defer { loading.remove(date) }
        let input: Input = ["date": .string(date)]
        if details[date] == nil, let saved = await Repo.cached("get_health_day", input, as: HealthDayDetail.self) { details[date] = saved }
        do {
            details[date] = try await Repo.fetch("get_health_day", input, as: HealthDayDetail.self)
            errors[date] = nil
            fresh.insert(date)
        } catch {
            if details[date] == nil {
                errors[date] = if case APIError.offline = error { "You're offline." } else { error.localizedDescription }
            }
        }
    }
}
