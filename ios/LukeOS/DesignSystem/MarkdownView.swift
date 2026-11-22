import SwiftUI

/// Markdown as blocks, enough for what LukeOS writes: headings, paragraphs, bullet, numbered and
/// check lists, quotes, code, dividers, tables and photos.
enum MDBlock: Hashable {
    case heading(Int, String)
    case paragraph(String)
    case bullet(String, indent: Int)
    case numbered(Int, String, indent: Int)
    case check(Bool, String, line: Int, indent: Int)
    case quote(String)
    case code(String)
    case divider
    case image(alt: String, src: String, width: Int?)
    case table([[String]])
}

enum Markdown {
    static func blocks(_ text: String) -> [MDBlock] {
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var out: [MDBlock] = []
        var para: [String] = []
        var i = 0
        func flush() {
            if !para.isEmpty { out.append(.paragraph(para.joined(separator: "\n"))); para = [] }
        }
        while i < lines.count {
            let raw = lines[i]
            let line = raw.trimmingCharacters(in: .whitespaces)
            let indent = (raw.prefix { $0 == " " }.count) / 2
            if line.isEmpty { flush(); i += 1; continue }
            if line.hasPrefix("```") {
                flush()
                var code: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") { code.append(lines[i]); i += 1 }
                out.append(.code(code.joined(separator: "\n")))
                i += 1
                continue
            }
            if let m = line.firstMatch(of: #/^(#{1,6})\s+(.*)$/#) {
                flush(); out.append(.heading(m.1.count, String(m.2))); i += 1; continue
            }
            if line == "---" || line == "***" || line == "___" { flush(); out.append(.divider); i += 1; continue }
            if let m = line.firstMatch(of: /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/) {
                flush()
                let src = String(m.2)
                let width = src.firstMatch(of: /#width=(\d+)/).flatMap { Int($0.1) }
                out.append(.image(alt: String(m.1), src: src.components(separatedBy: "#").first ?? src, width: width))
                i += 1
                continue
            }
            if line.hasPrefix("|"), i + 1 < lines.count, lines[i + 1].trimmingCharacters(in: .whitespaces).firstMatch(of: /^\|?\s*:?-{2,}/) != nil {
                flush()
                var rows: [[String]] = [cells(line)]
                i += 2
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("|") { rows.append(cells(lines[i])); i += 1 }
                out.append(.table(rows))
                continue
            }
            if let m = line.firstMatch(of: /^[-*+]\s+\[( |x|X)\]\s?(.*)$/) {
                flush(); out.append(.check(m.1 != " ", String(m.2), line: i, indent: indent)); i += 1; continue
            }
            if let m = line.firstMatch(of: /^[-*+]\s+(.*)$/) {
                flush(); out.append(.bullet(String(m.1), indent: indent)); i += 1; continue
            }
            if let m = line.firstMatch(of: /^(\d+)[.)]\s+(.*)$/) {
                flush(); out.append(.numbered(Int(m.1) ?? 1, String(m.2), indent: indent)); i += 1; continue
            }
            if line.hasPrefix(">") {
                flush()
                var q: [String] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(">") {
                    q.append(String(lines[i].trimmingCharacters(in: .whitespaces).dropFirst()).trimmingCharacters(in: .whitespaces))
                    i += 1
                }
                out.append(.quote(q.joined(separator: "\n")))
                continue
            }
            para.append(line)
            i += 1
        }
        flush()
        return out
    }

    private static func cells(_ line: String) -> [String] {
        var s = line.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("|") { s.removeFirst() }
        if s.hasSuffix("|") { s.removeLast() }
        return s.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    /// Inline Markdown (bold, italic, code, links, strikethrough) as styled text.
    static func inline(_ s: String) -> AttributedString {
        var text = (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
        for run in text.runs {
            if let intent = run.inlinePresentationIntent {
                if intent.contains(.stronglyEmphasized) { text[run.range].font = .geist(.body, medium: true) }
                if intent.contains(.code) { text[run.range].font = .geistMono(size: 14.5); text[run.range].backgroundColor = .raised }
            }
            if run.link != nil { text[run.range].underlineStyle = .single }
        }
        return text
    }

    /// Ticks or unticks the checklist item on a line.
    static func toggleCheck(_ text: String, line: Int) -> String {
        var lines = text.components(separatedBy: "\n")
        guard line < lines.count else { return text }
        if let r = lines[line].range(of: #"\[( |x|X)\]"#, options: .regularExpression) {
            let on = lines[line][r] != "[ ]"
            lines[line].replaceSubrange(r, with: on ? "[ ]" : "[x]")
        }
        return lines.joined(separator: "\n")
    }

    /// Whether the app can edit this Markdown without losing anything (tables stay on the web).
    static func isEditable(_ text: String) -> Bool {
        !blocks(text).contains { if case .table = $0 { return true }; return false }
            && !text.contains("<") // raw HTML
    }
}

/// Rendered Markdown in Luke's type. Checklists can be ticked when `onToggle` is given.
struct MarkdownView: View {
    var text: String
    var onToggle: ((Int) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(Markdown.blocks(text).enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tint(.ink)
    }

    @ViewBuilder
    private func blockView(_ block: MDBlock) -> some View {
        switch block {
        case .heading(let level, let s):
            Text(Markdown.inline(s))
                .textStyle(level == 1 ? .section : level == 2 ? .heading : .control, medium: true, color: .ink)
                .padding(.top, level == 1 ? 8 : 4)
        case .paragraph(let s):
            Text(Markdown.inline(s)).textStyle(.body, color: .subtleText).lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)
        case .bullet(let s, let indent):
            row(indent: indent) { Text("•").textStyle(.body, color: .mutedText) } content: { Text(Markdown.inline(s)) }
        case .numbered(let n, let s, let indent):
            row(indent: indent) { Text("\(n).").textStyle(.body, color: .mutedText).monospacedDigit() } content: { Text(Markdown.inline(s)) }
        case .check(let on, let s, let line, let indent):
            row(indent: indent) {
                Button {
                    Haptics.tap()
                    onToggle?(line)
                } label: {
                    Image(systemName: on ? "checkmark.square.fill" : "square")
                        .font(.system(size: 18))
                        .foregroundStyle(on ? Color.ink : Color.icon)
                }
                .buttonStyle(.plain)
                .disabled(onToggle == nil)
            } content: {
                Text(Markdown.inline(s)).strikethrough(on, color: .mutedText).foregroundStyle(on ? Color.mutedText : Color.subtleText)
            }
        case .quote(let s):
            Text(Markdown.inline(s)).textStyle(.body, color: .mutedText).italic()
                .padding(.leading, 14)
                .overlay(alignment: .leading) { Rectangle().fill(Color.stroke).frame(width: 3) }
        case .code(let s):
            ScrollView(.horizontal) {
                Text(s).font(.geistMono(size: 14)).foregroundStyle(Color.text).padding(12)
            }
            .background(Color.raised, in: .rect(cornerRadius: Radius.control))
        case .divider:
            Rectangle().fill(Color.hairline).frame(height: 1).padding(.vertical, 6)
        case .image(let alt, let src, let width):
            RemoteImage(path: src)
                .frame(maxWidth: .infinity, alignment: .leading)
                .containerRelativeFrame(.horizontal) { w, _ in w * CGFloat(width ?? 100) / 100 }
                .clipShape(.rect(cornerRadius: Radius.control))
                .accessibilityLabel(alt.isEmpty ? "Photo" : alt)
        case .table(let rows):
            ScrollView(.horizontal) {
                Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { r, cells in
                        GridRow {
                            ForEach(Array(cells.enumerated()), id: \.offset) { _, cell in
                                Text(Markdown.inline(cell))
                                    .textStyle(.preview, medium: r == 0, color: r == 0 ? .ink : .subtleText)
                                    .padding(.horizontal, 12).padding(.vertical, 9)
                                    .frame(minWidth: 80, maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                                    .background(r == 0 ? Color.muted : Color.clear)
                                    .overlay { Rectangle().strokeBorder(Color.hairline, lineWidth: 0.5) }
                            }
                        }
                    }
                }
                .clipShape(.rect(cornerRadius: Radius.control))
                .overlay(RoundedRectangle(cornerRadius: Radius.control).strokeBorder(Color.stroke, lineWidth: 1))
            }
            .scrollIndicators(.hidden)
        }
    }

    private func row<M: View, C: View>(indent: Int, @ViewBuilder marker: () -> M, @ViewBuilder content: () -> C) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            marker().frame(minWidth: 18, alignment: .leading)
            content().textStyle(.body, color: .subtleText).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.leading, CGFloat(indent) * 20)
    }
}
