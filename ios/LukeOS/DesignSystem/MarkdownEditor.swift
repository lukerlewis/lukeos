import SwiftUI
import UIKit

/// Edits Markdown as Markdown, styled as you type (headings big, bold bold, list marks quiet), so
/// whatever the web editor wrote reads back unchanged. Lists continue on return; checklist boxes tick on tap.
struct MarkdownEditor: UIViewRepresentable {
    @Binding var text: String
    var placeholder = "Start writing"
    var autoFocus = false
    var onPhoto: (() -> Void)?
    var proxy: EditorProxy?
    var onEndEditing: (() -> Void)?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.delegate = context.coordinator
        tv.backgroundColor = .clear
        tv.isScrollEnabled = false
        tv.textContainerInset = .zero
        tv.textContainer.lineFragmentPadding = 0
        tv.keyboardDismissMode = .interactive
        tv.allowsEditingTextAttributes = false
        tv.autocapitalizationType = .sentences
        tv.smartDashesType = .no
        tv.smartQuotesType = .no
        tv.typingAttributes = MDStyle.base
        tv.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        tv.inputAccessoryView = context.coordinator.makeToolbar()
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        tap.delegate = context.coordinator
        tv.addGestureRecognizer(tap)
        context.coordinator.textView = tv
        proxy?.coordinator = context.coordinator
        context.coordinator.apply(text)
        if autoFocus { DispatchQueue.main.async { tv.becomeFirstResponder() } }
        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        context.coordinator.parent = self
        if tv.text != text { context.coordinator.apply(text) }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? UIScreen.main.bounds.width
        let size = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: max(size.height, 200))
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        var parent: MarkdownEditor
        weak var textView: UITextView?

        init(_ parent: MarkdownEditor) { self.parent = parent }

        func apply(_ text: String) {
            guard let tv = textView else { return }
            let selected = tv.selectedRange
            tv.attributedText = MDStyle.styled(text)
            tv.selectedRange = NSRange(location: min(selected.location, (text as NSString).length), length: 0)
            tv.typingAttributes = MDStyle.base
        }

        func textViewDidEndEditing(_ tv: UITextView) { parent.onEndEditing?() }

        func textViewDidChange(_ tv: UITextView) {
            restyle(tv)
            parent.text = tv.text
        }

        private func restyle(_ tv: UITextView) {
            let sel = tv.selectedRange
            let styled = MDStyle.styled(tv.text)
            tv.textStorage.beginEditing()
            styled.enumerateAttributes(in: NSRange(location: 0, length: styled.length)) { attrs, range, _ in
                tv.textStorage.setAttributes(attrs, range: range)
            }
            tv.textStorage.endEditing()
            tv.selectedRange = sel
            tv.typingAttributes = MDStyle.base
        }

        /// Return in a list item starts the next one; return on an empty item ends the list.
        func textView(_ tv: UITextView, shouldChangeTextIn range: NSRange, replacementText string: String) -> Bool {
            guard string == "\n" else { return true }
            let ns = tv.text as NSString
            let lineRange = ns.lineRange(for: NSRange(location: range.location, length: 0))
            let line = ns.substring(with: lineRange).trimmingCharacters(in: .newlines)
            guard let m = line.firstMatch(of: /^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)[.)] |> )(.*)$/) else { return true }
            if m.4.isEmpty {
                // Empty item: take the marker away.
                tv.textStorage.replaceCharacters(in: NSRange(location: lineRange.location, length: (line as NSString).length), with: "")
                tv.selectedRange = NSRange(location: lineRange.location, length: 0)
                textViewDidChange(tv)
                return false
            }
            var marker = String(m.2)
            if let n = m.3.flatMap({ Int($0) }) { marker = "\(n + 1)" + String(m.2.dropFirst(String(n).count)) }
            if marker.contains("[x]") || marker.contains("[X]") { marker = marker.replacingOccurrences(of: "[x]", with: "[ ]").replacingOccurrences(of: "[X]", with: "[ ]") }
            insert("\n" + m.1 + marker, in: tv, at: range)
            return false
        }

        private func insert(_ s: String, in tv: UITextView, at range: NSRange) {
            tv.textStorage.replaceCharacters(in: range, with: NSAttributedString(string: s, attributes: MDStyle.base))
            tv.selectedRange = NSRange(location: range.location + (s as NSString).length, length: 0)
            textViewDidChange(tv)
        }

        // MARK: Ticking checklist boxes

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

        @objc func tapped(_ g: UITapGestureRecognizer) {
            guard let tv = textView else { return }
            let point = g.location(in: tv)
            guard let pos = tv.closestPosition(to: point) else { return }
            let index = tv.offset(from: tv.beginningOfDocument, to: pos)
            let ns = tv.text as NSString
            let lineRange = ns.lineRange(for: NSRange(location: min(index, ns.length), length: 0))
            let line = ns.substring(with: lineRange)
            guard let box = line.range(of: #"^\s*[-*+] \[( |x|X)\]"#, options: .regularExpression) else { return }
            let boxEnd = lineRange.location + line.distance(from: line.startIndex, to: box.upperBound)
            guard index <= boxEnd + 1 else { return }
            let lineNo = ns.substring(to: lineRange.location).components(separatedBy: "\n").count - 1
            let toggled = Markdown.toggleCheck(tv.text, line: lineNo)
            let sel = tv.selectedRange
            tv.text = toggled
            restyle(tv)
            tv.selectedRange = sel
            parent.text = toggled
            Haptics.tap()
        }

        // MARK: Formatting bar

        func makeToolbar() -> UIView {
            let bar = FormatBar(
                hasPhoto: parent.onPhoto != nil,
                act: { [weak self] action in self?.perform(action) }
            )
            let host = UIHostingController(rootView: bar)
            host.view.backgroundColor = .clear
            host.view.frame = CGRect(x: 0, y: 0, width: 320, height: 54)
            host.view.autoresizingMask = [.flexibleWidth]
            host.sizingOptions = []
            return host.view
        }

        func perform(_ action: FormatBar.Action) {
            switch action {
            case .h1: linePrefix("# ")
            case .h2: linePrefix("## ")
            case .h3: linePrefix("### ")
            case .body: linePrefix("")
            case .quote: linePrefix("> ")
            case .code: wrap("`", "`")
            case .divider: insertBlock("---")
            case .bold: bold()
            case .italic: italic()
            case .strike: strike()
            case .bullets: bullets()
            case .numbers: numbers()
            case .checklist: checklist()
            case .link: link()
            case .photo: photo()
            case .done: done()
            }
        }

        @objc func bold() { wrap("**", "**") }
        @objc func italic() { wrap("*", "*") }
        @objc func strike() { wrap("~~", "~~") }
        @objc func bullets() { linePrefix("- ") }
        @objc func numbers() { linePrefix("1. ") }
        @objc func checklist() { linePrefix("- [ ] ") }
        @objc func done() { textView?.resignFirstResponder() }
        @objc func photo() { parent.onPhoto?() }
        @objc func link() {
            guard let tv = textView else { return }
            let r = tv.selectedRange
            let selected = (tv.text as NSString).substring(with: r)
            let pasted = UIPasteboard.general.hasURLs ? UIPasteboard.general.url?.absoluteString ?? "" : ""
            let s = "[\(selected.isEmpty ? "link" : selected)](\(pasted))"
            insert(s, in: tv, at: r)
            if pasted.isEmpty { tv.selectedRange = NSRange(location: r.location + (s as NSString).length - 1, length: 0) }
        }

        func wrap(_ a: String, _ b: String) {
            guard let tv = textView else { return }
            let r = tv.selectedRange
            let selected = (tv.text as NSString).substring(with: r)
            insert(a + selected + b, in: tv, at: r)
            if selected.isEmpty { tv.selectedRange = NSRange(location: r.location + (a as NSString).length, length: 0) }
        }

        /// Sets the current line's block marker (heading, list, quote), replacing any it had.
        func linePrefix(_ prefix: String) {
            guard let tv = textView else { return }
            let ns = tv.text as NSString
            let lineRange = ns.lineRange(for: NSRange(location: tv.selectedRange.location, length: 0))
            let line = ns.substring(with: lineRange).trimmingCharacters(in: .newlines)
            let bare = line.replacingOccurrences(of: #"^(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )"#, with: "", options: .regularExpression)
            let current = String(line.dropLast(bare.count))
            let next = current == prefix ? bare : prefix + bare
            tv.textStorage.replaceCharacters(in: NSRange(location: lineRange.location, length: (line as NSString).length), with: next)
            tv.selectedRange = NSRange(location: lineRange.location + (next as NSString).length, length: 0)
            textViewDidChange(tv)
        }

        func insertBlock(_ s: String) {
            guard let tv = textView else { return }
            let r = tv.selectedRange
            let before = r.location > 0 ? (tv.text as NSString).substring(with: NSRange(location: r.location - 1, length: 1)) : "\n"
            insert((before == "\n" ? "" : "\n") + s + "\n", in: tv, at: r)
        }

        /// Puts a photo's Markdown where the cursor is.
        func insertImage(_ markdown: String) { insertBlock(markdown) }
    }
}

/// The formatting bar above the keyboard: scrolls sideways, with Done always in reach.
struct FormatBar: View {
    enum Action { case h1, h2, h3, body, quote, code, divider, bold, italic, strike, bullets, numbers, checklist, link, photo, done }
    var hasPhoto: Bool
    var act: (Action) -> Void

    var body: some View {
        HStack(spacing: Space.s) {
            ScrollView(.horizontal) {
                HStack(spacing: Space.xs / 2) {
                    Menu {
                        Button("Heading 1") { act(.h1) }
                        Button("Heading 2") { act(.h2) }
                        Button("Heading 3") { act(.h3) }
                        Button("Body") { act(.body) }
                        Divider()
                        Button("Quote", systemImage: "text.quote") { act(.quote) }
                        Button("Code", systemImage: "chevron.left.forwardslash.chevron.right") { act(.code) }
                        Button("Divider", systemImage: "minus") { act(.divider) }
                    } label: { icon("textformat.size") }
                        .accessibilityLabel("Text style")
                    button("bold", "Bold", .bold)
                    button("italic", "Italic", .italic)
                    button("strikethrough", "Strikethrough", .strike)
                    button("list.bullet", "Bulleted list", .bullets)
                    button("list.number", "Numbered list", .numbers)
                    button("checklist", "Checklist", .checklist)
                    button("link", "Link", .link)
                    if hasPhoto { button("photo", "Photo", .photo) }
                }
                .padding(.horizontal, Space.line)
            }
            .scrollIndicators(.hidden)
            .glassEffect(.regular, in: .capsule)
            Button { act(.done) } label: { icon("keyboard.chevron.compact.down") }
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel("Hide keyboard")
        }
        .foregroundStyle(Color.ink)
        .padding(.horizontal, Space.m)
        .padding(.bottom, Space.line)
    }

    private func icon(_ symbol: String) -> some View {
        Image(systemName: symbol).font(.icon(.row)).frame(width: Size.composerButton, height: Size.tap)
    }

    private func button(_ symbol: String, _ label: String, _ a: Action) -> some View {
        Button { act(a) } label: { icon(symbol) }.accessibilityLabel(label)
    }
}

/// Lets a screen reach into the editor (to drop in a photo).
@MainActor
final class EditorProxy {
    weak var coordinator: MarkdownEditor.Coordinator?
    func insertImage(_ markdown: String) { coordinator?.insertImage(markdown) }
    func focus() { coordinator?.textView?.becomeFirstResponder() }
}

/// The look of Markdown while it's being written.
enum MDStyle {
    static func font(_ name: String, _ size: CGFloat, _ style: UIFont.TextStyle = .body) -> UIFont {
        UIFontMetrics(forTextStyle: style).scaledFont(for: UIFont(name: name, size: size) ?? .systemFont(ofSize: size))
    }

    static let text = UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0xCECECE) : UIColor(hex: 0x424242) }
    static let ink = UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0xF5F5F5) : UIColor(hex: 0x121212) }
    static let quiet = UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0x5D5D5D) : UIColor(hex: 0xA4A4A4) }
    static let muted = UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0xA4A4A4) : UIColor(hex: 0x636363) }
    static let codeBack = UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0x222222) : UIColor(hex: 0xF2F2F2) }

    static var paragraph: NSParagraphStyle {
        let p = NSMutableParagraphStyle()
        p.lineSpacing = 5
        p.paragraphSpacing = 4
        return p
    }

    static var base: [NSAttributedString.Key: Any] {
        [.font: font("Geist-Regular", 16), .foregroundColor: text, .paragraphStyle: paragraph]
    }

    static func styled(_ s: String) -> NSAttributedString {
        let out = NSMutableAttributedString(string: s, attributes: base)
        let ns = s as NSString
        var inCode = false
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: [.byLines, .substringNotRequired]) { _, lineRange, _, _ in
            let line = ns.substring(with: lineRange)
            if line.hasPrefix("```") {
                inCode.toggle()
                out.addAttributes([.font: font("GeistMono-Regular", 14), .foregroundColor: quiet], range: lineRange)
                return
            }
            if inCode {
                out.addAttributes([.font: font("GeistMono-Regular", 14), .backgroundColor: codeBack], range: lineRange)
                return
            }
            func dim(_ r: NSRange) { out.addAttribute(.foregroundColor, value: quiet, range: r) }
            if let m = line.firstMatch(of: #/^(#{1,6}) /#) {
                let level = m.1.count
                let size: CGFloat = level == 1 ? 24 : level == 2 ? 19 : 17
                out.addAttributes([.font: font("Geist-Medium", size, .title2), .foregroundColor: ink, .kern: -0.04 * size], range: lineRange)
                dim(NSRange(location: lineRange.location, length: level + 1))
                return
            }
            if let m = line.firstMatch(of: /^(\s*[-*+] \[([ xX])\] )/) {
                let len = (String(m.1) as NSString).length
                dim(NSRange(location: lineRange.location, length: len))
                if m.2 != " " {
                    out.addAttributes([.strikethroughStyle: NSUnderlineStyle.single.rawValue, .foregroundColor: muted],
                                      range: NSRange(location: lineRange.location + len, length: lineRange.length - len))
                }
            } else if let m = line.firstMatch(of: /^(\s*(?:[-*+]|\d+[.)]) )/) {
                dim(NSRange(location: lineRange.location, length: (String(m.1) as NSString).length))
            } else if line.hasPrefix(">") {
                out.addAttributes([.font: font("Geist-Italic", 16), .foregroundColor: muted], range: lineRange)
                dim(NSRange(location: lineRange.location, length: 1))
            } else if line == "---" || line == "***" {
                dim(lineRange)
            } else if line.hasPrefix("![") {
                out.addAttributes([.font: font("GeistMono-Regular", 13), .foregroundColor: muted], range: lineRange)
                return
            }
            inline(out, line: line, at: lineRange.location)
        }
        return out
    }

    private static func inline(_ out: NSMutableAttributedString, line: String, at offset: Int) {
        let ns = line as NSString
        func each(_ pattern: String, _ body: (NSTextCheckingResult) -> Void) {
            guard let re = try? NSRegularExpression(pattern: pattern) else { return }
            for m in re.matches(in: line, range: NSRange(location: 0, length: ns.length)) { body(m) }
        }
        func shift(_ r: NSRange) -> NSRange { NSRange(location: r.location + offset, length: r.length) }
        func dimMarks(_ m: NSTextCheckingResult, _ n: Int) {
            out.addAttribute(.foregroundColor, value: quiet, range: shift(NSRange(location: m.range.location, length: n)))
            out.addAttribute(.foregroundColor, value: quiet, range: shift(NSRange(location: NSMaxRange(m.range) - n, length: n)))
        }
        each(#"\*\*[^*\n]+\*\*|__[^_\n]+__"#) { m in
            out.addAttributes([.font: font("Geist-Medium", 16), .foregroundColor: ink], range: shift(m.range))
            dimMarks(m, 2)
        }
        each(#"(?<![*\w])\*[^*\n]+\*(?!\*)|(?<![_\w])_[^_\n]+_(?!_)"#) { m in
            out.addAttribute(.font, value: font("Geist-Italic", 16), range: shift(m.range))
            dimMarks(m, 1)
        }
        each(#"~~[^~\n]+~~"#) { m in
            out.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: shift(m.range))
            dimMarks(m, 2)
        }
        each(#"`[^`\n]+`"#) { m in
            out.addAttributes([.font: font("GeistMono-Regular", 14.5), .backgroundColor: codeBack], range: shift(m.range))
        }
        each(#"\[([^\]\n]+)\]\(([^)\n]*)\)"#) { m in
            out.addAttribute(.foregroundColor, value: quiet, range: shift(m.range))
            out.addAttributes([.foregroundColor: ink, .underlineStyle: NSUnderlineStyle.single.rawValue], range: shift(m.range(at: 1)))
        }
    }
}
