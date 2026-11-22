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
}
