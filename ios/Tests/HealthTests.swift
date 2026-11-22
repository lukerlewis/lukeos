import XCTest
import UIKit
@testable import LukeOS

/// The Health page reads leniently: missing fields, nulls and fields it doesn't know never break it.
final class HealthTests: XCTestCase {
    private func decode(_ json: String) throws -> HealthAnswer {
        try LukeAPI.decoder.decode(HealthAnswer.self, from: Data(json.utf8))
    }

    private var fixtures: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appending(path: "Fixtures")
    }

    func testFullPayloadDecodes() throws {
        let a = try LukeAPI.decoder.decode(HealthAnswer.self, from: Data(contentsOf: fixtures.appending(path: "get_health.json")))
        XCTAssertTrue(a.isConnected)
        XCTAssertEqual(a.today, "2026-11-21")
        XCTAssertEqual(a.days?.count, 30)
        let today = try XCTUnwrap(a.days?.first { $0.date == a.today })
        XCTAssertNotNil(today.steps)
        XCTAssertNotNil(today.sleep?.minutes)
    }

    func testAllNullDayDecodesAsNoData() throws {
        let a = try decode(#"{"configured":true,"connected":true,"today":"2026-11-21","days":[{"date":"2026-11-21","steps":null,"distanceMeters":null,"activeMinutes":null,"caloriesOut":null,"restingHeartRate":null,"hrvMs":null,"breathingRate":null,"spo2":null,"skinTempDeviation":null,"vo2Max":null,"sleep":null,"workouts":[]}]}"#)
        let d = try XCTUnwrap(a.days?.first)
        XCTAssertNil(d.steps)
        XCTAssertNil(d.sleep)
        XCTAssertNil(HealthMath.average([d.steps]))
    }

    func testNotConfiguredPayload() throws {
        let a = try decode(#"{"configured":false,"connected":false,"lastSyncAt":null,"days":[]}"#)
        XCTAssertFalse(a.isConnected)
        let fixture = try LukeAPI.decoder.decode(HealthAnswer.self, from: Data(contentsOf: fixtures.appending(path: "get_health.notconfigured.json")))
        XCTAssertFalse(fixture.isConnected)
    }

    func testUnknownFieldsAndIntegersAreFine() throws {
        let a = try decode(#"{"connected":true,"configured":true,"newThing":{"x":1},"days":[{"date":"2026-11-20","steps":8412,"mood":"good","sleep":{"minutes":431,"score":82},"workouts":[{"type":"Run","minutes":31,"elevation":40}]}]}"#)
        XCTAssertEqual(a.days?.first?.steps, 8412)
        XCTAssertEqual(a.days?.first?.sleep?.minutes, 431)
        XCTAssertEqual(a.days?.first?.workouts?.first?.type, "Run")
    }

    func testDayHasData() throws {
        let empty = try decode(#"{"configured":true,"connected":true,"today":"2026-11-21","days":[{"date":"2026-11-20","steps":null,"sleep":null,"workouts":[]},{"date":"2026-11-21","steps":null,"sleep":null,"workouts":[]}]}"#)
        XCTAssertTrue(empty.isConnected)
        XCTAssertFalse(empty.hasAnyData)
        XCTAssertFalse(HealthDay(date: "2026-11-21", workouts: []).hasData)
        XCTAssertTrue(HealthDay(date: "2026-11-21", steps: 0).hasData)
        XCTAssertTrue(HealthDay(date: "2026-11-21", workouts: [.init(type: "RUNNING")]).hasData)
        XCTAssertTrue(HealthDay(date: "2026-11-21", sleep: .init(minutes: 300)).hasData)
        let full = try LukeAPI.decoder.decode(HealthAnswer.self, from: Data(contentsOf: fixtures.appending(path: "get_health.json")))
        XCTAssertTrue(full.hasAnyData)
    }

    func testAxisIsAnchoredAtToday() {
        XCTAssertEqual(HealthMath.axisDays(today: "2026-11-21", range: 30), ["2026-10-24", "2026-10-31", "2026-11-07", "2026-11-14", "2026-11-21"])
        XCTAssertEqual(HealthMath.axisDays(today: "2026-11-21", range: 7).count, 7)
        XCTAssertEqual(HealthMath.axisDays(today: "2026-11-21", range: 7).last, "2026-11-21")
        // 90 days: every 21st day back from today, five labels.
        XCTAssertEqual(HealthMath.axisDays(today: "2026-11-21", range: 90), ["2026-08-29", "2026-09-19", "2026-10-10", "2026-10-31", "2026-11-21"])
    }

    func testLinesBreakAtMissingDays() {
        let r = HealthMath.runs([("a", 1), ("b", nil), ("c", 3), ("d", 4), ("e", nil)])
        XCTAssertEqual(r.map { $0.points.map(\.0) }, [["a"], ["c", "d"]])
        XCTAssertEqual(r.map(\.id), [0, 1])
        XCTAssertTrue(HealthMath.runs([("a", nil)]).isEmpty)
    }

    func testAverageSkipsMissingDays() {
        XCTAssertEqual(HealthMath.average([10, nil, 20, nil]), 15)
        XCTAssertNil(HealthMath.average([nil, nil]))
        XCTAssertNil(HealthMath.average([]))
    }

    func testLastNightUsesTheServersToday() {
        func day(_ date: String, _ minutes: Double?) -> HealthDay {
            HealthDay(date: date, sleep: minutes.map { HealthDay.Sleep(minutes: $0) })
        }
        // Sleep is filed under the day Luke woke up: today's entry is last night.
        let a = HealthMath.lastNight([day("2026-11-20", 400), day("2026-11-21", 450)], today: "2026-11-21")
        XCTAssertEqual(a?.sleep.minutes, 450)
        XCTAssertEqual(a?.date, "2026-11-21")
        // Not synced yet today: yesterday's entry, and it says so.
        let b = HealthMath.lastNight([day("2026-11-20", 400), day("2026-11-21", nil)], today: "2026-11-21")
        XCTAssertEqual(b?.sleep.minutes, 400)
        XCTAssertEqual(b?.date, "2026-11-20")
        // Older than yesterday isn't shown.
        XCTAssertNil(HealthMath.lastNight([day("2026-11-18", 400)], today: "2026-11-21"))
    }

    func testWorkoutTitles() {
        func title(_ type: String?, _ name: String? = nil) -> String {
            HealthMath.workoutTitle(HealthDay.Workout(type: type, name: name))
        }
        XCTAssertEqual(title("STRENGTH_TRAINING"), "Strength training")
        XCTAssertEqual(title("HIIT"), "HIIT")
        XCTAssertEqual(title("OUTDOOR_BIKE"), "Outdoor bike")
        XCTAssertEqual(title("WORKOUT"), "Workout")
        XCTAssertEqual(title("run"), "Run")
        XCTAssertEqual(title("indoor-climbing"), "Indoor climbing")
        XCTAssertEqual(title("Open Water Swim"), "Open Water Swim")
        XCTAssertEqual(title(nil), "Workout")
        // Luke's own name wins; a blank one doesn't.
        XCTAssertEqual(title("RUNNING", "Lunch run"), "Lunch run")
        XCTAssertEqual(title("RUNNING", "  "), "Running")
    }

    func testWorkoutSymbols() {
        XCTAssertEqual(HealthMath.workoutSymbol("RUNNING"), "figure.run")
        XCTAssertEqual(HealthMath.workoutSymbol("OUTDOOR_BIKE"), "figure.outdoor.cycle")
        XCTAssertEqual(HealthMath.workoutSymbol("CYCLING"), "figure.outdoor.cycle")
        XCTAssertEqual(HealthMath.workoutSymbol("WEIGHTLIFTING"), "dumbbell")
        XCTAssertEqual(HealthMath.workoutSymbol("STRENGTH_TRAINING"), "dumbbell")
        XCTAssertEqual(HealthMath.workoutSymbol("HIIT"), "figure.highintensity.intervaltraining")
        XCTAssertEqual(HealthMath.workoutSymbol("ELLIPTICAL"), "figure.elliptical")
        XCTAssertEqual(HealthMath.workoutSymbol("HIKING"), "figure.hiking")
        XCTAssertEqual(HealthMath.workoutSymbol("WORKOUT"), "figure.mixed.cardio")
        XCTAssertEqual(HealthMath.workoutSymbol(nil), "figure.mixed.cardio")
        // Every symbol used exists.
        for t in ["HIIT", "ELLIPTICAL", "HIKING", "RUNNING", "WALKING", "OUTDOOR_BIKE", "SWIMMING", "ROWING", "WEIGHTLIFTING", "YOGA", "PILATES", "TENNIS", "SOCCER", "BASKETBALL", "GOLF", "DANCE", "WORKOUT"] {
            XCTAssertNotNil(UIImage(systemName: HealthMath.workoutSymbol(t)), t)
        }
    }

    func testFixtureWorkoutsHaveNamesAndRawTypes() throws {
        let a = try LukeAPI.decoder.decode(HealthAnswer.self, from: Data(contentsOf: fixtures.appending(path: "get_health.json")))
        let ws = (a.days ?? []).flatMap { $0.workouts ?? [] }
        XCTAssertTrue(ws.contains { $0.name == "Leg day" })
        XCTAssertTrue(ws.allSatisfy { $0.type == $0.type?.uppercased() })
    }

    func testFormatting() {
        XCTAssertEqual(HealthMath.hm(432), "7h 12m")
        XCTAssertEqual(HealthMath.hm(45), "45m")
        XCTAssertEqual(HealthMath.miles(5000), "3.1 mi")
        XCTAssertEqual(HealthMath.skinTemp(0.3), "+0.5°F")
        XCTAssertEqual(HealthMath.skinTemp(-0.5), "−0.9°F")
        // Rounded first: a tiny change is no change, with no sign.
        XCTAssertEqual(HealthMath.skinTemp(-0.01), "0.0°F")
        XCTAssertEqual(HealthMath.skinTemp(0), "0.0°F")
        XCTAssertEqual(HealthMath.skinTemp(0.03), "+0.1°F")
    }

    // MARK: Section pages

    func testEverySectionReadsAndFormatsItsNumber() {
        let d = HealthDay(date: "2026-11-21", steps: 6340, activeMinutes: 78, restingHeartRate: 58, hrvMs: 48, breathingRate: 14, spo2: 96.7,
                          skinTempDeviation: 0.1, vo2Max: 44, sleep: .init(minutes: 441))
        let shown = HealthSection.allCases.map { s in s.value(d).map(s.format) }
        XCTAssertEqual(shown, ["7h 21m", "6,340", "58 bpm", "48 ms", "78 min", "14.0 /min", "96.7%", "+0.2°F", "44.0"])
        XCTAssertEqual(HealthSection.allCases.filter(\.adds), [.steps, .activeZoneMinutes])
        XCTAssertEqual(HealthSection.allCases.filter { $0.dayDetail != nil }, [.sleep, .steps, .heartRate, .activeZoneMinutes])
        XCTAssertEqual(HealthSection.allCases.filter { $0.chart == .bar }, [.sleep, .steps, .activeZoneMinutes])
        // The ids match the website's /health/<id>.
        XCTAssertEqual(HealthSection(rawValue: "active-zone-minutes"), .activeZoneMinutes)
        XCTAssertEqual(HealthSection.sleep.plotted(450), 7.5)
        XCTAssertEqual(HealthSection.steps.tick(12_000), "12k")
        for s in HealthSection.allCases { XCTAssertNotNil(UIImage(systemName: s.symbol), s.rawValue) }
    }

    func testStats() {
        let s = HealthDetailMath.stats([10, nil, 30, 20], total: true)
        XCTAssertEqual(s.map(\.label), ["Average", "Lowest", "Highest", "Total"])
        XCTAssertEqual(s.map(\.value), [20, 10, 30, 60])
        XCTAssertEqual(HealthDetailMath.stats([5], total: false).map(\.label), ["Average", "Lowest", "Highest"])
        XCTAssertTrue(HealthDetailMath.stats([nil, nil], total: true).isEmpty)
    }

    func testInitialPickAndStepping() {
        let days = [HealthDay(date: "2026-11-19", steps: 1), HealthDay(date: "2026-11-20", steps: 2), HealthDay(date: "2026-11-21")]
        // The newest day with a value, not an empty today.
        XCTAssertEqual(HealthDetailMath.initialPick(days, section: .steps, asked: nil), "2026-11-20")
        XCTAssertEqual(HealthDetailMath.initialPick(days, section: .steps, asked: "2026-11-19"), "2026-11-19")
        XCTAssertEqual(HealthDetailMath.initialPick(days, section: .steps, asked: "2026-01-01"), "2026-11-20")
        XCTAssertEqual(HealthDetailMath.initialPick(days, section: .hrv, asked: nil), "2026-11-21")
        XCTAssertNil(HealthDetailMath.initialPick([], section: .steps, asked: nil))
        XCTAssertEqual(HealthDetailMath.step(days, from: "2026-11-20", by: 1), "2026-11-21")
        XCTAssertNil(HealthDetailMath.step(days, from: "2026-11-21", by: 1))
        XCTAssertEqual(HealthDetailMath.step(days, from: "2026-11-20", by: -1), "2026-11-19")
    }

    func testHours() {
        var hours = [Double?](repeating: nil, count: 24)
        XCTAssertNil(HealthDetailMath.busiestHour(hours))
        hours[9] = 300; hours[18] = 1800; hours[19] = 1800
        XCTAssertEqual(HealthDetailMath.busiestHour(hours), 18)
        XCTAssertEqual(HealthDetailMath.hourLabel(0), "12a")
        XCTAssertEqual(HealthDetailMath.hourLabel(6), "6a")
        XCTAssertEqual(HealthDetailMath.hourLabel(12), "12p")
        XCTAssertEqual(HealthDetailMath.hourLabel(18), "6p")
        XCTAssertEqual(HealthDetailMath.hourLabel(24), "12a")
        XCTAssertEqual(HealthDetailMath.hourRange(18), "6–7 PM")
        XCTAssertEqual(HealthDetailMath.hourRange(11), "11 AM–12 PM")
        XCTAssertEqual(HealthDetailMath.hourRange(23), "11 PM–12 AM")
        XCTAssertEqual(HealthDetailMath.hourRange(0), "12–1 AM")
    }

    func testHeartRateBreaksWhereTheWatchWasOff() {
        let points: [HealthDayDetail.HeartPoint] = [
            .init(time: "2026-11-21T12:10:00.000Z", bpm: 70, min: 66, max: 75),
            .init(time: "2026-11-21T12:00:00.000Z", bpm: 60, min: 58, max: 64),
            .init(time: "2026-11-21T12:05:00.000Z", bpm: 65),
            .init(time: nil, bpm: 80),
            .init(time: "2026-11-21T13:00:00.000Z", bpm: 90, min: 85, max: 99),
        ]
        let samples = HealthDetailMath.heartSamples(points)
        XCTAssertEqual(samples.map(\.bpm), [60, 65, 70, 90])
        XCTAssertEqual(samples[1].min, 65)
        XCTAssertEqual(HealthDetailMath.runs(samples).map { $0.map(\.bpm) }, [[60, 65, 70], [90]])
    }

    func testSleepStages() throws {
        let stages: [HealthDayDetail.Stage] = [
            .init(stage: "LIGHT", start: "2026-11-21T03:00:00Z", end: "2026-11-21T04:00:00Z"),
            .init(stage: "AWAKE", start: "2026-11-21T02:50:00Z", end: "2026-11-21T03:00:00Z"),
            .init(stage: "DEEP", start: "2026-11-21T04:00:00Z", end: "2026-11-21T04:30:00Z"),
            // A night split in two, with a gap.
            .init(stage: "REM", start: "2026-11-21T06:00:00Z", end: "2026-11-21T06:20:00Z"),
            .init(stage: "LIGHT", start: "2026-11-21T06:20:00Z", end: "2026-11-21T06:50:00Z"),
            .init(stage: "BROKEN", start: "2026-11-21T07:00:00Z", end: "2026-11-21T06:00:00Z"),
        ]
        let spans = HealthDetailMath.sleepSpans(stages)
        XCTAssertEqual(spans.first?.stage, "AWAKE")
        XCTAssertEqual(spans.count, 5)
        XCTAssertEqual(HealthDetailMath.stageRows(spans), ["AWAKE", "REM", "LIGHT", "DEEP"])
        let totals = HealthDetailMath.stageTotals(spans)
        XCTAssertEqual(totals.map(\.minutes), [10, 20, 90, 30])
        XCTAssertEqual(totals.map(\.percent), [7, 13, 60, 20])
        XCTAssertEqual(HealthDetailMath.stageRows(HealthDetailMath.sleepSpans([.init(stage: "asleep", start: "2026-11-21T03:00:00Z", end: "2026-11-21T04:00:00Z"),
                                                                                .init(stage: "RESTLESS", start: "2026-11-21T04:00:00Z", end: "2026-11-21T04:05:00Z")])),
                       ["RESTLESS", "ASLEEP"])
        XCTAssertEqual(HealthDetailMath.stageName("ASLEEP"), "Asleep")
    }

    func testDayDetailFixture() throws {
        let d = try LukeAPI.decoder.decode(HealthDayDetail.self, from: Data(contentsOf: fixtures.appending(path: "get_health_day.json")))
        XCTAssertEqual(d.date, "2026-11-21")
        XCTAssertEqual(d.stepsByHour?.count, 24)
        XCTAssertEqual(d.stepsByHour?.compactMap { $0 }.reduce(0, +), 6340)
        XCTAssertFalse(HealthDetailMath.heartSamples(d.heartRate ?? []).isEmpty)
        let totals = HealthDetailMath.stageTotals(HealthDetailMath.sleepSpans(d.sleepStages ?? []))
        XCTAssertEqual(Dictionary(uniqueKeysWithValues: totals.map { ($0.stage, $0.minutes) }), ["AWAKE": 36, "REM": 98, "LIGHT": 285, "DEEP": 58])
        // Lenient like the rest: nulls and unknown fields are fine.
        let sparse = try LukeAPI.decoder.decode(HealthDayDetail.self, from: Data(#"{"date":"2026-11-21","stepsByHour":[null,4],"heartRate":[{"time":"2026-11-21T12:00:00Z","bpm":60,"min":null,"max":null}],"sleepStages":[],"extra":1}"#.utf8))
        XCTAssertEqual(sparse.stepsByHour?.count, 2)
        XCTAssertEqual(HealthDetailMath.heartSamples(sparse.heartRate ?? []).first?.max, 60)
    }

    func testUpdatedFooter() {
        let tz = TimeZone(identifier: "America/New_York")!
        let now = ISO8601DateFormatter().date(from: "2026-11-22T02:07:00Z")! // 9:07 PM on the 21st
        func at(_ s: String) -> String? { HealthDetailMath.updated(s, now: now, today: "2026-11-21", timeZone: tz) }
        XCTAssertEqual(at("2026-11-22T02:06:30Z"), "Updated just now")
        XCTAssertEqual(at("2026-11-22T02:05:00Z"), "Updated 2 min ago")
        XCTAssertEqual(at("2026-11-21T23:00:00Z"), "Updated 3 hr ago")
        XCTAssertEqual(at("2026-11-21T06:00:00Z"), "Updated 20 hr ago") // 1 AM the same day
        XCTAssertEqual(at("2026-11-20T15:00:00Z"), "Updated yesterday")
        XCTAssertEqual(at("2026-11-17T15:00:00Z"), "Updated Tue 17 Nov")
        XCTAssertNil(at("not a time"))
    }

    func testDayBoundsAreLukesMidnights() {
        let b = HealthDetailMath.dayBounds("2026-11-21", timeZone: TimeZone(identifier: "America/New_York")!)
        XCTAssertEqual(ISO8601DateFormatter().string(from: b.lowerBound), "2026-11-21T05:00:00Z")
        XCTAssertEqual(b.upperBound.timeIntervalSince(b.lowerBound), 86_400)
    }
}
