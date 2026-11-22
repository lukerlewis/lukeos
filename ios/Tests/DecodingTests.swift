import XCTest
@testable import LukeOS

/// Every model decodes the real server responses in Fixtures/.
final class DecodingTests: XCTestCase {
    private func data(_ file: String) throws -> Data {
        let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appending(path: "Fixtures")
        return try Data(contentsOf: folder.appending(path: file))
    }

    private func decode<T: Decodable>(_ file: String, as: T.Type) throws {
        XCTAssertNoThrow(try LukeAPI.decoder.decode(T.self, from: try data(file)), file)
    }

    func testFixturesDecode() throws {
        try decode("app_home.json", as: AppHome.self)
        try decode("app_messages.json", as: MessagesAnswer.self)
        try decode("get_dashboard.json", as: DashboardAnswer.self)
        try decode("get_today.json", as: TodayAnswer.self)
        try decode("list_tasks.json", as: [LukeTask].self)
        try decode("list_tasks.done.json", as: [LukeTask].self)
        try decode("get_task.json", as: LukeTask.self)
        try decode("list_projects.json", as: [Project].self)
        try decode("get_project.json", as: ProjectDetail.self)
        try decode("list_links.json", as: [SavedLink].self)
        try decode("list_notes.json", as: [NoteSummary].self)
        try decode("list_folders.json", as: [Folder].self)
        for f in ["get_note.json", "get_note.table.json", "get_note.html.json", "get_note.checklist.json"] { try decode(f, as: Note.self) }
        try decode("list_documents.json", as: [DocumentSummary].self)
        try decode("get_document.json", as: LukeDocument.self)
        try decode("list_comments.task.json", as: [Comment].self)
        try decode("list_comments.document.json", as: [Comment].self)
        try decode("get_focus_stats.json", as: FocusStats.self)
        try decode("get_focus_stats.30.json", as: FocusStats.self)
        try decode("get_focus.json", as: AppHome.Focus.self)
        try decode("list_episodes.json", as: EpisodeList.self)
        try decode("list_playlists.json", as: PlaylistList.self)
        try decode("get_playlist.json", as: Playlist.self)
        try decode("get_playlist.empty.json", as: Playlist.self)
        try decode("list_inspiration.json", as: [InspirationItem].self)
        try decode("get_inspiration.json", as: InspirationItem.self)
        try decode("list_inspiration_tags.json", as: [TagCount].self)
        try decode("search.json", as: [SearchHit].self)
        try decode("list_trash.json", as: [TrashItem].self)
    }

    func testSmartEntry() {
        let today = "2026-11-21" // a Saturday
        var e = SmartEntry.parse("put away laundry tomorrow", today: today)
        XCTAssertEqual(e.title, "put away laundry")
        XCTAssertEqual(e.dueDate, "2026-11-22")
        e = SmartEntry.parse("Call mum every week", today: today)
        XCTAssertEqual(e.title, "Call mum")
        XCTAssertEqual(e.repeat, "weekly")
        e = SmartEntry.parse("call the bank this week", today: today)
        XCTAssertEqual(e.bucket, .this_week)
        e = SmartEntry.parse("gym every other day", today: today)
        XCTAssertEqual(e.repeat, "every_2_days")
        e = SmartEntry.parse("pay rent monthly from the 1st", today: today)
        XCTAssertEqual(e.repeat, "monthly")
        XCTAssertEqual(e.dueDate, "2026-12-01")
        e = SmartEntry.parse("weekly report", today: today)
        XCTAssertNil(e.repeat)
        e = SmartEntry.parse("dentist next friday", today: today)
        XCTAssertEqual(e.dueDate, "2026-11-27")
    }

    func testMarkdownRoundTrip() {
        let md = "# A\n\n- [ ] one\n- [x] two"
        XCTAssertEqual(Markdown.toggleCheck(md, line: 2), "# A\n\n- [x] one\n- [x] two")
        XCTAssertFalse(Markdown.isEditable("| a | b |\n|---|---|\n| 1 | 2 |"))
        XCTAssertTrue(Markdown.isEditable(md))
    }
}
