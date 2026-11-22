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
}
