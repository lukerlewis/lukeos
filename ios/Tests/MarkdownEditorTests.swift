import XCTest
import UIKit
import SwiftUI
@testable import LukeOS

/// The note editor must never change a note's Markdown unless Luke types: styling only adds
/// attributes, and splitting around tables joins back to the same bytes.
@MainActor
final class MarkdownEditorTests: XCTestCase {
    private var fixtures: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appending(path: "Fixtures")
    }

    /// Every piece of Markdown in the fixtures: notes, documents, task notes, the scratch pad.
    private func fixtureMarkdown() throws -> [String] {
        var out: [String] = []
        for file in ["get_note.json", "get_note.table.json", "get_note.checklist.json", "get_document.json"] {
            let d = try JSONDecoder().decode([String: JSON].self, from: Data(contentsOf: fixtures.appending(path: file)))
            if let c = d["content"]?.stringValue { out.append(c) }
        }
        let tasks = try LukeAPI.decoder.decode([LukeTask].self, from: Data(contentsOf: fixtures.appending(path: "list_tasks.json")))
        out += tasks.compactMap(\.notes)
        let home = try LukeAPI.decoder.decode(AppHome.self, from: Data(contentsOf: fixtures.appending(path: "app_home.json")))
        if let pad = home.scratchPad?.content { out.append(pad) }
        return out
    }

    private let nasty: [String] = [
        "- one\n  - nested\n    - deeper\n- [ ] task\n  - [x] done child\n",
        "```swift\nlet a = \"# not a heading\"\n| not | a table |\n- not a list\n```\nafter\n",
        "| a | b |\n|---|---|\n| 1 | 2 |\n\ntext after the table\n",
        "Before\n\n| Step | What |\n|:---|---:|\n| 1 | **bold** |\n",
        "A [link with [brackets]](https://example.com/a_(b)) and ![photo](/api/images/abc#width=50)\n",
        "Emoji ☕️ 👩🏽‍💻 and accents: café, naïve 🇬🇧\n",
        "Trailing spaces for a break  \nnext line   \n",
        "Windows line endings\r\n- item\r\n- [ ] box\r\n",
        "> quote **bold** _italic_ ~~gone~~ `code`\n> second line",
        "# H1\n## H2\n### H3\n#### H4\nplain *italic* __bold__\n---\n1. one\n2) two\n",
        "",
        "No newline at the end",
        "* star bullet\n+ plus bullet\n- [X] capital X\n",
    ]

    func testStylingNeverChangesTheText() throws {
        for md in try fixtureMarkdown() + nasty {
            XCTAssertEqual(MDStyle.styled(md).string, md)
            // With every line in turn being edited, too.
            let ns = md as NSString
            var loc = 0
            while loc < ns.length {
                let line = ns.lineRange(for: NSRange(location: loc, length: 0))
                XCTAssertEqual(MDStyle.styled(md, activeLine: line).string, md)
                loc = NSMaxRange(line)
            }
        }
    }

    func testTablesSplitAndJoinBackExactly() throws {
        for md in try fixtureMarkdown() + nasty {
            XCTAssertEqual(NoteSegments.join(NoteSegments.split(md)), md, md)
        }
        let parts = NoteSegments.split("Before\n\n| a | b |\n|---|---|\n| 1 | 2 |\nAfter\n")
        XCTAssertEqual(parts, [.text("Before\n\n"), .table("| a | b |\n|---|---|\n| 1 | 2 |\n"), .text("After\n")])
        // A table at the end still leaves somewhere to type.
        XCTAssertEqual(NoteSegments.split("| a |\n|---|\n").last, .text(""))
        // Pipes inside a code block aren't a table.
        XCTAssertEqual(NoteSegments.split("```\n| a |\n|---|\n```\n").count, 1)
    }

    func testTheTextViewKeepsTheBytes() throws {
        for md in try fixtureMarkdown() + nasty where !md.contains("\r\n") {
            let tv = UITextView(usingTextLayoutManager: true)
            tv.attributedText = MDStyle.styled(md)
            XCTAssertEqual(tv.text, md)
        }
    }

    func testOpeningAndClosingSavesNothing() throws {
        // The editor only writes back when the text view reports typing; loading styles it and stops.
        let md = try fixtureMarkdown()[0]
        var writes = 0
        let editor = MarkdownEditor(text: Binding(get: { md }, set: { _ in writes += 1 }))
        let coordinator = editor.makeCoordinator()
        let tv = UITextView(usingTextLayoutManager: true)
        coordinator.textView = tv
        coordinator.apply(md)
        coordinator.textViewDidBeginEditing(tv)
        coordinator.textViewDidChangeSelection(tv)
        coordinator.textViewDidEndEditing(tv)
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(tv.text, md)
    }

    func testMarksHideExceptOnTheEditedLine() {
        let md = "# Title\n- [ ] Box\n- Bullet\nSome **bold**"
        let styled = MDStyle.styled(md)
        let font = styled.attribute(.font, at: 0, effectiveRange: nil) as? UIFont
        XCTAssertLessThan(font?.pointSize ?? 99, 1, "the # is hidden")
        let titleFont = styled.attribute(.font, at: 2, effectiveRange: nil) as? UIFont
        XCTAssertGreaterThan(titleFont?.pointSize ?? 0, LukeType.body.size, "heading is big")
        XCTAssertEqual(styled.attribute(.mdMarker, at: 8, effectiveRange: nil) as? String, "check")
        XCTAssertEqual(styled.attribute(.mdMarker, at: 18, effectiveRange: nil) as? String, "bullet")
        // On the line being edited, marks show (dimmed) and no box is drawn.
        let editing = MDStyle.styled(md, activeLine: NSRange(location: 8, length: 10))
        XCTAssertNil(editing.attribute(.mdMarker, at: 8, effectiveRange: nil))
        let markFont = editing.attribute(.font, at: 8, effectiveRange: nil) as? UIFont
        XCTAssertGreaterThan(markFont?.pointSize ?? 0, 1)
    }

    func testTypingHashSpaceMakesAHeadingAtOnce() {
        let styled = MDStyle.styled("# H", activeLine: NSRange(location: 0, length: 3))
        let f = styled.attribute(.font, at: 2, effectiveRange: nil) as? UIFont
        XCTAssertGreaterThan(f?.pointSize ?? 0, LukeType.body.size)
    }

    func testReturnContinuesAndEndsLists() {
        func press(_ text: String) -> String? {
            guard let e = MarkdownTyping.returnPressed(in: text, at: NSRange(location: (text as NSString).length, length: 0)) else { return nil }
            return (text as NSString).replacingCharacters(in: e.range, with: e.replacement)
        }
        XCTAssertEqual(press("- milk"), "- milk\n- ")
        XCTAssertEqual(press("  - nested"), "  - nested\n  - ")
        XCTAssertEqual(press("- [x] done"), "- [x] done\n- [ ] ")
        XCTAssertEqual(press("- [ ] todo"), "- [ ] todo\n- [ ] ")
        XCTAssertEqual(press("3. three"), "3. three\n4. ")
        XCTAssertEqual(press("> said"), "> said\n> ")
        XCTAssertNil(press("plain text"))
        // A second Return on an empty item ends the list.
        XCTAssertEqual(press("- milk\n- "), "- milk\n")
        XCTAssertEqual(press("- [ ] a\n- [ ] "), "- [ ] a\n")
        XCTAssertEqual(press("1. a\n2. "), "1. a\n")
    }

    func testFormattingBarLinePrefixes() {
        func apply(_ prefix: String, _ text: String) -> String {
            let e = MarkdownTyping.setLinePrefix(prefix, in: text, at: 0)
            return (text as NSString).replacingCharacters(in: e.range, with: e.replacement)
        }
        XCTAssertEqual(apply("# ", "Title"), "# Title")
        XCTAssertEqual(apply("## ", "# Title"), "## Title")
        XCTAssertEqual(apply("# ", "# Title"), "Title")
        XCTAssertEqual(apply("- [ ] ", "- item"), "- [ ] item")
        XCTAssertEqual(apply("> ", "quote"), "> quote")
    }

    func testTickingABoxChangesOnlyThatBox() {
        let md = "- [ ] a\n- [x] b\n"
        XCTAssertEqual(Markdown.toggleCheck(md, line: 0), "- [x] a\n- [x] b\n")
        XCTAssertEqual(Markdown.toggleCheck(md, line: 1), "- [ ] a\n- [ ] b\n")
    }
}
