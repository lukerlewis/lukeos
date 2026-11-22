import SwiftUI
import Charts

// MARK: A section's page

/// One Health number over 7, 30 or 90 days: the picked day's value, a chart to tap or scrub, its stats,
/// the picked day within the day (sleep, steps, heart) and every day as a list, newest first.
struct HealthSectionScreen: View {
    let section: HealthSection
    var askedDate: String?

    @State private var range = 30
    @State private var answer: HealthAnswer?
    @State private var picked: String?
    @State private var offline = false
    @State private var dayStore = HealthDayStore.shared

    private var today: String { answer?.today ?? AppModel.shared.today }
    private var timeZone: TimeZone { answer?.timeZone.flatMap(TimeZone.init(identifier:)) ?? .current }
    private var days: [HealthDay] { Array((answer?.days ?? []).suffix(range)) }
    private var pickedDay: HealthDay? { days.first { $0.date == picked } }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                Section {
                    Picker("Range", selection: $range) {
                        Text("7 days").tag(7)
                        Text("30 days").tag(30)
                        Text("90 days").tag(90)
                    }
                    .pickerStyle(.segmented)
                    .controlRow()
                    .id("top")
                }
                if answer != nil, !days.isEmpty {
                    content(proxy)
                } else if offline {
                    EmptyNote(text: "You're offline.", symbol: "wifi.slash").listRowBackground(Color.clear)
                } else if answer != nil {
                    EmptyNote(text: "No data yet.", symbol: section.symbol).listRowBackground(Color.clear)
                } else {
                    DelayedSpinner().listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .pageBackground()
        }
        .navigationTitle(section.title)
        .navigationBarTitleDisplayMode(.inline)
        .sensoryFeedback(.selection, trigger: picked) { old, _ in old != nil }
        .refreshable {
            await load()
            if let picked, section.dayDetail != nil { await dayStore.load(picked, force: true) }
        }
        .task(id: range) { await load() }
        .task(id: picked) {
            if let picked, section.dayDetail != nil { await dayStore.load(picked) }
        }
    }

    @ViewBuilder
    private func content(_ proxy: ScrollViewProxy) -> some View {
        let values = days.map(section.value)
        let pickedValue = pickedDay.flatMap(section.value)
        Section {
            VStack(alignment: .leading, spacing: Space.l) {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text(picked.map { Day.friendly($0, today: today) } ?? " ").textStyle(.meta, color: .mutedText)
                    Text(pickedValue.map(section.format) ?? "–").textStyle(.title, medium: true, color: .ink).monospacedDigit()
                        .contentTransition(.numericText())
                }
                .accessibilityElement(children: .combine)
                SectionChart(section: section, days: days, today: today, range: range, picked: picked) { date in
                    withAnimation(Motion.snappy) { picked = date }
                }
            }
            .padding(.vertical, Space.s)
            .cardRow()
        }
        let stats = HealthDetailMath.stats(values, total: section.adds)
        if !stats.isEmpty {
            Section {
                Grid(horizontalSpacing: Space.m, verticalSpacing: Space.m) {
                    if stats.count == 4 {
                        GridRow { tile(stats[0]); tile(stats[1]) }
                        GridRow { tile(stats[2]); tile(stats[3]) }
                    } else {
                        GridRow { ForEach(stats, id: \.label) { tile($0) } }
                    }
                }
                .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            } header: { SectionTitle(text: "Last \(range) days") }
        }
        if let kind = section.dayDetail, let pickedDay {
            Section {
                HealthDayCard(kind: kind, day: pickedDay, detail: dayStore.details[pickedDay.date],
                              error: dayStore.errors[pickedDay.date], timeZone: timeZone)
                    .cardRow()
            } header: { SectionTitle(text: dayTitle(kind)) }
        }
        Section {
            ForEach(Array(zip(days, values)).reversed(), id: \.0.date) { day, value in
                Button {
                    withAnimation(Motion.snappy) {
                        picked = day.date
                        proxy.scrollTo("top", anchor: .top)
                    }
                } label: {
                    HStack(spacing: Space.m) {
                        Text(Day.friendly(day.date, today: today)).textStyle(.control, color: .text)
                        Spacer()
                        Text(value.map(section.format) ?? "–")
                            .textStyle(.control, medium: value != nil, color: value == nil ? .mutedText : .ink).monospacedDigit()
                    }
                    .frame(minHeight: Size.tap - Space.m)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .listRowBackground(day.date == picked ? Color.selected : Color.card)
                .listRowSeparatorTint(Color.hairline)
                .listRowInsets(EdgeInsets(top: Space.s, leading: Space.inset, bottom: Space.s, trailing: Space.inset))
                .accessibilityAddTraits(day.date == picked ? .isSelected : [])
            }
        } header: { SectionTitle(text: "By day") }
    }

    private func tile(_ s: HealthDetailMath.Stat) -> some View {
        StatTile(title: s.label, value: section.format(s.value), keepsDetailLine: false)
    }

    private func dayTitle(_ kind: HealthSection.DayDetail) -> String {
        switch kind {
        case .sleep: "The night"
        case .steps: "Through the day"
        case .heart: "Heart rate through the day"
        }
    }

    private var input: Input {
        var i: Input = ["days": .number(Double(range))]
        let args = ProcessInfo.processInfo.arguments
        if SharedConfig.isDemo, let k = args.firstIndex(of: "-healthState"), k + 1 < args.count { i["demoState"] = .string(args[k + 1]) }
        return i
    }

    private func load() async {
        let input = input
        if let c = await Repo.cached("get_health", input, as: HealthAnswer.self) { adopt(c) }
        else if answer == nil, let c = await Repo.cached("get_health", ["days": 30], as: HealthAnswer.self) { adopt(c) }
        do {
            adopt(try await Repo.fetch("get_health", input, as: HealthAnswer.self))
            offline = false
        } catch {
            offline = answer == nil
        }
    }

    private func adopt(_ a: HealthAnswer) {
        answer = a
        let inRange = Array((a.days ?? []).suffix(range))
        if picked == nil || !inRange.contains(where: { $0.date == picked }) {
            picked = HealthDetailMath.initialPick(inRange, section: section, asked: picked ?? askedDate)
        }
    }
}

// MARK: The chart

/// Bars (sleep stacked Deep / REM / Light) or a line over the range. Tap or drag across it to pick a day.
struct SectionChart: View {
    let section: HealthSection
    let days: [HealthDay]
    let today: String
    let range: Int
    let picked: String?
    let onPick: (String) -> Void

    @State private var scrub: Date?

    private var domain: ClosedRange<Date> {
        Day.toLocal(Day.add(today, days: -(range - 1)))...Day.toLocal(Day.add(today, days: 1))
    }

    var body: some View {
        Group {
            if section.chart == .bar { bars } else { line }
        }
        .chartXScale(domain: domain)
        .chartXAxis {
            AxisMarks(values: HealthMath.axisDays(today: today, range: range).map { Day.toLocal($0).addingTimeInterval(12 * 3600) }) { value in
                let anchor: UnitPoint = range <= 7 ? .top : value.index == 0 ? .topLeading : value.index == value.count - 1 ? .topTrailing : .top
                AxisValueLabel(format: range <= 7 ? .dateTime.weekday(.narrow) : .dateTime.day().month(.abbreviated), centered: false, anchor: anchor)
            }
        }
        .chartYAxis {
            AxisMarks(position: .trailing) { v in
                AxisGridLine()
                AxisValueLabel { if let n = v.as(Double.self) { Text(section.tick(n)) } }
            }
        }
        .chartXSelection(value: $scrub)
        .onChange(of: scrub) { _, date in
            guard let date else { return }
            let day = Day.fromLocal(date)
            if day != picked, days.contains(where: { $0.date == day }) { onPick(day) }
        }
        .frame(height: Size.chartHeight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(section.title), last \(range) days")
        .accessibilityValue(accessibilityValue)
        .accessibilityAdjustableAction { direction in
            guard let picked else { return }
            if let next = HealthDetailMath.step(days, from: picked, by: direction == .increment ? 1 : -1) { onPick(next) }
        }
    }

    private var accessibilityValue: String {
        guard let picked, let day = days.first(where: { $0.date == picked }) else { return "" }
        return "\(Day.friendly(picked, today: today)), \(section.value(day).map(section.format) ?? "nothing recorded")"
    }

    private struct Piece: Identifiable {
        var id: String { "\(date)-\(part)" }
        var date: String
        var part: String
        var value: Double
        var color: Color
    }

    /// Sleep is stacked by stage when the night has stages; everything else is one bar.
    private var pieces: [Piece] {
        days.flatMap { d -> [Piece] in
            guard let v = section.value(d), v > 0 else { return [] }
            if section == .sleep, let s = d.sleep, s.deepMinutes != nil || s.remMinutes != nil || s.lightMinutes != nil {
                return [("Deep", s.deepMinutes, Color.ink), ("REM", s.remMinutes, Color.subtleText), ("Light", s.lightMinutes, Color.strokeStrong)]
                    .compactMap { name, m, c in (m ?? 0) > 0 ? Piece(date: d.date, part: name, value: m! / 60, color: c) : nil }
            }
            return [Piece(date: d.date, part: "", value: section.plotted(v), color: d.date == picked ? .ink : .strokeStrong)]
        }
    }

    private var bars: some View {
        Chart {
            ForEach(pieces) { p in
                BarMark(x: .value("Day", Day.toLocal(p.date), unit: .day), y: .value(section.title, p.value))
                    .foregroundStyle(p.color)
                    .opacity(section == .sleep && p.date != picked ? 0.45 : 1)
            }
            if let goal = section.goal {
                RuleMark(y: .value("Goal", section.plotted(goal)))
                    .foregroundStyle(Color.stroke)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
            }
        }
    }

    private var line: some View {
        let runs = HealthMath.runs(days.map { ($0.date, section.value($0).map(section.plotted)) })
        let points = runs.flatMap { r in r.points.map { (date: $0.0, value: $0.1, run: r.id) } }
        let lo = points.map(\.value).min() ?? 0, hi = points.map(\.value).max() ?? 1
        let pad = max((hi - lo) * 0.2, section == .skinTemperature ? 0.3 : 1)
        let pickedPoint = points.first { $0.date == picked }
        return Chart {
            if let picked {
                RuleMark(x: .value("Day", Day.toLocal(picked), unit: .day))
                    .foregroundStyle(Color.hairline)
                    .lineStyle(StrokeStyle(lineWidth: 1))
            }
            ForEach(points, id: \.date) { p in
                LineMark(x: .value("Day", Day.toLocal(p.date), unit: .day), y: .value(section.title, p.value), series: .value("Stretch", p.run))
                    .foregroundStyle(Color.strokeStrong)
                    // Straight between days: a smoothed curve invents highs and lows that weren't measured.
                    .interpolationMethod(.linear)
                PointMark(x: .value("Day", Day.toLocal(p.date), unit: .day), y: .value(section.title, p.value))
                    .foregroundStyle(Color.strokeStrong)
                    .symbolSize(range <= 7 ? 24 : range <= 30 ? 10 : 4)
            }
            if let p = pickedPoint {
                PointMark(x: .value("Day", Day.toLocal(p.date), unit: .day), y: .value(section.title, p.value))
                    .foregroundStyle(Color.ink)
                    .symbolSize(64)
            }
        }
        .chartYScale(domain: (lo - pad)...(hi + pad))
    }
}

// MARK: The picked day, within the day

struct HealthDayCard: View {
    let kind: HealthSection.DayDetail
    let day: HealthDay
    let detail: HealthDayDetail?
    let error: String?
    let timeZone: TimeZone

    var body: some View {
        Group {
            if let detail {
                switch kind {
                case .sleep: SleepNightView(sleep: day.sleep ?? detail.sleep, spans: HealthDetailMath.sleepSpans(detail.sleepStages ?? []), timeZone: timeZone)
                case .steps: StepsDayView(hours: detail.stepsByHour ?? [])
                case .heart: HeartDayView(samples: HealthDetailMath.heartSamples(detail.heartRate ?? []), day: day.date, timeZone: timeZone)
                }
            } else if let error {
                Text(error).textStyle(.control, color: .mutedText)
            } else {
                RoundedRectangle(cornerRadius: Radius.control)
                    .fill(Color.muted)
                    .frame(height: Size.chartHeight)
                    .phaseAnimator([1.0, 0.5]) { v, phase in v.opacity(phase) } animation: { _ in .easeInOut(duration: 0.9) }
                    .accessibilityLabel("Loading")
            }
        }
        .padding(.vertical, Space.s)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A time of day in Luke's time zone, "11:04 PM".
private func clock(_ d: Date, _ tz: TimeZone) -> String {
    var f = Date.FormatStyle(date: .omitted, time: .shortened)
    f.timeZone = tz
    return d.formatted(f)
}

private func stageColor(_ stage: String) -> Color {
    switch stage {
    case "DEEP": .ink
    case "REM", "ASLEEP": .subtleText
    case "LIGHT": .strokeStrong
    default: .stroke
    }
}

struct SleepNightView: View {
    let sleep: HealthDay.Sleep?
    let spans: [SleepSpan]
    let timeZone: TimeZone

    var body: some View {
        if let s = sleep, let minutes = s.minutes, minutes > 0 {
            VStack(alignment: .leading, spacing: Space.xl) {
                Grid(alignment: .leading, horizontalSpacing: Space.m) {
                    GridRow {
                        fact("Asleep", HealthMath.hm(minutes))
                        fact("Fell asleep", Stamp.date(s.start).map { clock($0, timeZone) } ?? "–")
                        fact("Woke up", Stamp.date(s.end).map { clock($0, timeZone) } ?? "–")
                    }
                }
                if !spans.isEmpty {
                    timeline
                    VStack(spacing: 0) {
                        ForEach(Array(HealthDetailMath.stageTotals(spans).enumerated()), id: \.offset) { i, t in
                            if i > 0 { Divider().overlay(Color.hairline) }
                            HStack(spacing: Space.m) {
                                RoundedRectangle(cornerRadius: 3).fill(stageColor(t.stage)).frame(width: 10, height: 10)
                                Text(HealthDetailMath.stageName(t.stage)).textStyle(.control, color: .text)
                                Spacer()
                                Text("\(t.percent)%").textStyle(.meta, color: .mutedText).monospacedDigit()
                                Text(HealthMath.hm(t.minutes)).textStyle(.control, medium: true, color: .ink).monospacedDigit()
                                    .frame(minWidth: 64, alignment: .trailing)
                            }
                            .frame(minHeight: Size.tap)
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
            }
        } else {
            Text("No sleep recorded for this night.").textStyle(.control, color: .mutedText)
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text(label).textStyle(.meta, color: .mutedText)
            Text(value).textStyle(.control, medium: true, color: .ink).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// One row per stage, each stretch placed by time across the night.
    private var timeline: some View {
        let rows = HealthDetailMath.stageRows(spans).map(HealthDetailMath.stageName)
        let start = spans.map(\.start).min()!, end = spans.map(\.end).max()!
        return Chart {
            ForEach(rows, id: \.self) { row in
                RectangleMark(xStart: .value("Start", start), xEnd: .value("End", end), y: .value("Stage", row), height: .ratio(0.7))
                    .foregroundStyle(Color.muted)
                    .clipShape(.rect(cornerRadius: 3))
            }
            ForEach(spans, id: \.self) { s in
                RectangleMark(xStart: .value("Start", s.start), xEnd: .value("End", s.end),
                              y: .value("Stage", HealthDetailMath.stageName(s.stage)), height: .ratio(0.7))
                    .foregroundStyle(stageColor(s.stage))
            }
        }
        .chartXScale(domain: start...end)
        .chartYScale(domain: rows)
        .chartXAxis {
            AxisMarks(values: [start, end]) { v in
                AxisValueLabel(anchor: v.index == 0 ? .topLeading : .topTrailing) {
                    if let d = v.as(Date.self) { Text(clock(d, timeZone)) }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { _ in AxisValueLabel() }
        }
        .frame(height: CGFloat(rows.count) * 34 + 24)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Sleep stages from \(clock(start, timeZone)) to \(clock(end, timeZone))")
    }
}

struct StepsDayView: View {
    let hours: [Double?]

    private var bars: [(hour: Int, steps: Double)] {
        hours.prefix(24).enumerated().compactMap { h, v in (v ?? 0) > 0 ? (h, v!) : nil }
    }

    private func hourBar(_ h: Int, _ steps: Double, busiest: Bool) -> some ChartContent {
        let from = Double(h) + 0.12, to = Double(h) + 0.88
        return RectangleMark(xStart: .value("From", from), xEnd: .value("To", to), yStart: .value("Steps", 0.0), yEnd: .value("Steps", steps))
            .foregroundStyle(busiest ? Color.ink : Color.strokeStrong)
            .clipShape(.rect(cornerRadius: 2))
    }

    var body: some View {
        if let busiest = HealthDetailMath.busiestHour(hours) {
            VStack(alignment: .leading, spacing: Space.m) {
                Chart {
                    ForEach(bars, id: \.hour) { b in
                        hourBar(b.hour, b.steps, busiest: b.hour == busiest)
                    }
                }
                .chartXScale(domain: 0...24)
                .chartXAxis {
                    AxisMarks(values: [0, 6, 12, 18, 24]) { v in
                        AxisGridLine()
                        AxisValueLabel(anchor: v.index == 4 ? .topTrailing : .topLeading) {
                            if let h = v.as(Double.self) { Text(HealthDetailMath.hourLabel(Int(h))) }
                        }
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .trailing) { v in
                        AxisGridLine()
                        AxisValueLabel { if let n = v.as(Double.self) { Text(HealthSection.steps.tick(n)) } }
                    }
                }
                .frame(height: Size.chartHeight)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Steps by hour")
                Text("Busiest hour \(HealthDetailMath.hourRange(busiest)) · \(Int(hours[busiest] ?? 0).formatted()) steps")
                    .textStyle(.meta, color: .mutedText).monospacedDigit()
            }
        } else {
            Text("No steps recorded.").textStyle(.control, color: .mutedText)
        }
    }
}

struct HeartDayView: View {
    let samples: [HeartSample]
    let day: String
    let timeZone: TimeZone

    var body: some View {
        if let lowest = samples.min(by: { $0.min < $1.min }), let highest = samples.max(by: { $0.max < $1.max }) {
            let bounds = HealthDetailMath.dayBounds(day, timeZone: timeZone)
            let lo = (lowest.min / 10).rounded(.down) * 10, hi = (highest.max / 10).rounded(.up) * 10
            let runs = HealthDetailMath.runs(samples)
            VStack(alignment: .leading, spacing: Space.m) {
                Chart {
                    // The min–max band for each 5 minutes, then the average as a line (broken where the watch was off).
                    ForEach(samples, id: \.time) { s in
                        RectangleMark(xStart: .value("From", s.time), xEnd: .value("To", s.time.addingTimeInterval(5 * 60)),
                                      yStart: .value("Min", s.min), yEnd: .value("Max", s.max))
                            .foregroundStyle(Color.stroke.opacity(0.7))
                    }
                    ForEach(Array(runs.enumerated()), id: \.offset) { i, run in
                        ForEach(run, id: \.time) { s in
                            LineMark(x: .value("Time", s.time.addingTimeInterval(150)), y: .value("bpm", s.bpm), series: .value("Stretch", i))
                                .foregroundStyle(Color.ink)
                                .lineStyle(StrokeStyle(lineWidth: 1.5))
                        }
                    }
                }
                .chartXScale(domain: bounds)
                .chartYScale(domain: lo...hi)
                .chartXAxis {
                    AxisMarks(values: (0...4).map { bounds.lowerBound.addingTimeInterval(Double($0) * 6 * 3600) }) { v in
                        AxisGridLine()
                        AxisValueLabel(anchor: v.index == 4 ? .topTrailing : .topLeading) { Text(HealthDetailMath.hourLabel(v.index * 6)) }
                    }
                }
                .chartYAxis { AxisMarks(position: .trailing) { AxisGridLine(); AxisValueLabel() } }
                .frame(height: Size.chartHeight)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Heart rate through the day, from \(Int(lowest.min)) to \(Int(highest.max)) beats per minute")
                Text("Lowest \(Int(lowest.min)) bpm at \(clock(lowest.time, timeZone)) · Highest \(Int(highest.max)) bpm at \(clock(highest.time, timeZone))")
                    .textStyle(.meta, color: .mutedText).monospacedDigit()
            }
        } else {
            Text("No heart rate recorded.").textStyle(.control, color: .mutedText)
        }
    }
}

// MARK: A workout

struct WorkoutScreen: View {
    let ref: HealthWorkoutRef

    private var tz: TimeZone { ref.timeZone.flatMap(TimeZone.init(identifier:)) ?? .current }

    var body: some View {
        let w = ref.workout
        List {
            Section {
                HStack(spacing: Space.l) {
                    Image(systemName: HealthMath.workoutSymbol(w.type)).font(.icon(.hero)).foregroundStyle(Color.icon)
                        .frame(width: Size.tap, height: Size.tap)
                    VStack(alignment: .leading, spacing: Space.xs) {
                        Text(HealthMath.workoutTitle(w)).textStyle(.heading, medium: true, color: .ink)
                        Text(when).textStyle(.meta, color: .mutedText)
                    }
                }
                .padding(.vertical, Space.s)
                .cardRow()
                .accessibilityElement(children: .combine)
            }
            Section {
                ForEach(facts, id: \.0) { label, value in
                    HStack {
                        Text(label).textStyle(.control, color: .text)
                        Spacer()
                        Text(value).textStyle(.control, medium: true, color: .ink).monospacedDigit()
                    }
                    .frame(minHeight: Size.tap - Space.m)
                    .cardRow()
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .listStyle(.insetGrouped)
        .pageBackground()
        .navigationTitle("Workout")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// "Yesterday · 3:08 PM"
    private var when: String {
        let day = Day.friendly(ref.date, today: ref.today)
        guard let start = Stamp.date(ref.workout.startedAt) else { return day }
        return "\(day) · \(clock(start, tz))"
    }

    private var facts: [(String, String)] {
        let w = ref.workout
        var out: [(String, String)] = []
        if let t = w.type, !t.isEmpty { out.append(("Type", HealthMath.tidy(t))) }
        if let start = Stamp.date(w.startedAt) {
            var end = ""
            if let m = w.minutes { end = " – \(clock(start.addingTimeInterval(m * 60), tz))" }
            out.append(("Time", "\(clock(start, tz))\(end)"))
        }
        if let m = w.minutes { out.append(("Minutes", "\(Int(m.rounded())) min")) }
        if let d = w.distanceMeters, d > 0 { out.append(("Distance", HealthMath.miles(d))) }
        if let c = w.calories { out.append(("Calories", "\(Int(c.rounded())) cal")) }
        return out
    }
}
