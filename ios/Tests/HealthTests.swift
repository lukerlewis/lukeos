import XCTest
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

    func testAverageSkipsMissingDays() {
        XCTAssertEqual(HealthMath.average([10, nil, 20, nil]), 15)
        XCTAssertNil(HealthMath.average([nil, nil]))
        XCTAssertNil(HealthMath.average([]))
    }

    func testLastNightUsesTheServersToday() {
        func day(_ date: String, _ minutes: Double?) -> HealthDay {
            HealthDay(date: date, sleep: minutes.map { HealthDay.Sleep(minutes: $0) })
        }
        // Sleep filed under today wins.
        XCTAssertEqual(HealthMath.lastNight([day("2026-11-20", 400), day("2026-11-21", 450)], today: "2026-11-21")?.minutes, 450)
        // Not synced yet today: yesterday's.
        XCTAssertEqual(HealthMath.lastNight([day("2026-11-20", 400), day("2026-11-21", nil)], today: "2026-11-21")?.minutes, 400)
        // Older than yesterday isn't last night.
        XCTAssertNil(HealthMath.lastNight([day("2026-11-18", 400)], today: "2026-11-21"))
    }

    func testFormatting() {
        XCTAssertEqual(HealthMath.hm(432), "7h 12m")
        XCTAssertEqual(HealthMath.hm(45), "45m")
        XCTAssertEqual(HealthMath.miles(5000), "3.1 mi")
        XCTAssertEqual(HealthMath.skinTemp(0.3), "+0.5°F")
        XCTAssertEqual(HealthMath.skinTemp(-0.5), "−0.9°F")
    }
}
