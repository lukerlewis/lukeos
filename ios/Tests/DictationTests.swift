import XCTest
@testable import LukeOS

final class DictationTests: XCTestCase {
    func testTidyDropsNoiseMarksAndKeepsWords() {
        XCTAssertEqual(Dictation.tidy(" [BLANK_AUDIO] "), "")
        XCTAssertEqual(Dictation.tidy(" Hello there.  (silence) Um, LukeOS (the app) works. "), "Hello there. Um, LukeOS (the app) works.")
    }

    func testStatusSurvivesAFileRoundTrip() throws {
        let status = DictationStatus(phase: .ready, updatedAt: Date(timeIntervalSince1970: 100), resultID: "a", text: "Hi", error: nil)
        let data = try JSONEncoder().encode(status)
        XCTAssertEqual(try JSONDecoder().decode(DictationStatus.self, from: data), status)
    }

    func testHistoryDropsEntriesOlderThanAWeek() {
        let now = Date(timeIntervalSince1970: 1_000_000_000)
        let fresh = DictationEntry(id: "a", date: now.addingTimeInterval(-6 * 24 * 3600), text: "Kept", audio: nil)
        let old = DictationEntry(id: "b", date: now.addingTimeInterval(-8 * 24 * 3600), text: "Gone", audio: nil)
        XCTAssertEqual(DictationHistory.kept([fresh, old], now: now), [fresh])
    }
}
