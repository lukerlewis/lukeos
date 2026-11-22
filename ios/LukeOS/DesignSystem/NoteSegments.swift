import Foundation

/// A note split into text the phone edits and tables it leaves alone. Each part is the exact
/// slice of the original, so joining them gives back the note byte for byte.
enum NoteSegments {
    enum Segment: Equatable {
        case text(String)
        case table(String)
    }

    /// Splits at Markdown tables: a line starting with "|" followed by a separator line ("|---|").
    static func split(_ text: String) -> [Segment] {
        // Keep each line with its own line ending, so nothing is lost or normalised.
        var lines: [String] = []
        var current = ""
        for ch in text {
            current.append(ch)
            if ch == "\n" || ch == "\r\n" { lines.append(current); current = "" }
        }
        if !current.isEmpty { lines.append(current) }

        func isRow(_ l: String) -> Bool { l.trimmingCharacters(in: .whitespaces).hasPrefix("|") }
        func isSeparator(_ l: String) -> Bool {
            l.trimmingCharacters(in: .whitespacesAndNewlines).firstMatch(of: /^\|?\s*:?-{2,}/) != nil
        }

        var out: [Segment] = []
        var buffer = ""
        var i = 0
        var inFence = false
        while i < lines.count {
            let l = lines[i]
            if l.trimmingCharacters(in: .whitespaces).hasPrefix("```") { inFence.toggle() }
            if !inFence, isRow(l), i + 1 < lines.count, isSeparator(lines[i + 1]) {
                if !buffer.isEmpty { out.append(.text(buffer)); buffer = "" }
                var table = l + lines[i + 1]
                i += 2
                while i < lines.count, isRow(lines[i]) { table += lines[i]; i += 1 }
                out.append(.table(table))
                continue
            }
            buffer += l
            i += 1
        }
        // Always end with a text part, so there's somewhere to type after a table.
        if !buffer.isEmpty || out.isEmpty || { if case .table = out.last! { return true }; return false }() {
            out.append(.text(buffer))
        }
        return out
    }

    static func join(_ parts: [Segment]) -> String {
        parts.map { part in
            switch part {
            case .text(let s), .table(let s): s
            }
        }.joined()
    }

    /// Raw HTML (outside code) that the phone can't edit faithfully.
    static func hasRawHTML(_ text: String) -> Bool {
        var inFence = false
        for line in text.components(separatedBy: "\n") {
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") { inFence.toggle(); continue }
            if inFence { continue }
            let stripped = line.replacingOccurrences(of: "`[^`]*`", with: "", options: .regularExpression)
            if stripped.range(of: #"<(/?[a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?/?>"#, options: .regularExpression) != nil { return true }
        }
        return false
    }
}
