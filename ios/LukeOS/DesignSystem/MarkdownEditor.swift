import SwiftUI
import UIKit

/// Edits a note so it looks like the finished note while typing: headings at their sizes, bold, italic,
/// links, quotes, bullets drawn as bullets and checklists as real tick boxes. The text underneath is always
/// the Markdown itself, never rewritten, so what the web app wrote comes back byte for byte. The marks
/// (#, **, -, [ ]) are hidden except on the line being edited, where they show dimmed.
struct MarkdownEditor: UIViewRepresentable {
    @Binding var text: String
    var placeholder = "Start writing"
    var autoFocus = false
    var onPhoto: (() -> Void)?
    var proxy: EditorProxy?
    var onBeginEditing: (() -> Void)?
    var onEndEditing: (() -> Void)?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView(usingTextLayoutManager: true)
        tv.delegate = context.coordinator
        tv.textLayoutManager?.delegate = context.coordinator
        tv.backgroundColor = .clear
        tv.isScrollEnabled = false
        tv.textContainerInset = .zero
        tv.textContainer.lineFragmentPadding = 0
        tv.keyboardDismissMode = .interactive
        tv.allowsEditingTextAttributes = false
        tv.autocapitalizationType = .sentences
        tv.smartDashesType = .no
        tv.smartQuotesType = .no
        tv.smartInsertDeleteType = .no
        tv.typingAttributes = MDStyle.base
        tv.linkTextAttributes = [:]
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
        let width = proposal.width ?? uiView.window?.windowScene?.screen.bounds.width ?? 400
        let size = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: max(size.height, Size.rowMin))
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate, NSTextLayoutManagerDelegate {
        var parent: MarkdownEditor
        weak var textView: UITextView?
        /// The line the cursor is on, whose marks show; nil when not editing.
        private var activeLine: NSRange?

        init(_ parent: MarkdownEditor) { self.parent = parent }

        func apply(_ text: String) {
            guard let tv = textView else { return }
            let selected = tv.selectedRange
            tv.attributedText = MDStyle.styled(text, activeLine: tv.isFirstResponder ? activeLine : nil)
            tv.selectedRange = NSRange(location: min(selected.location, (text as NSString).length), length: 0)
            tv.typingAttributes = MDStyle.base
        }

        private func restyle(_ tv: UITextView) {
            let sel = tv.selectedRange
            let styled = MDStyle.styled(tv.text, activeLine: tv.isFirstResponder ? activeLine : nil)
            tv.textStorage.beginEditing()
            styled.enumerateAttributes(in: NSRange(location: 0, length: styled.length)) { attrs, range, _ in
                tv.textStorage.setAttributes(attrs, range: range)
            }
            tv.textStorage.endEditing()
            tv.selectedRange = sel
            tv.typingAttributes = MDStyle.base
        }

        private func lineRange(_ tv: UITextView) -> NSRange {
            (tv.text as NSString).lineRange(for: NSRange(location: min(tv.selectedRange.location, (tv.text as NSString).length), length: 0))
        }

        func textViewDidBeginEditing(_ tv: UITextView) {
            parent.onBeginEditing?()
            // The tap's caret lands after this call; show that line's marks once it has.
            DispatchQueue.main.async { [weak self, weak tv] in
                guard let self, let tv, tv.isFirstResponder else { return }
                self.activeLine = self.lineRange(tv)
                self.restyle(tv)
            }
        }

        func textViewDidEndEditing(_ tv: UITextView) {
            activeLine = nil
            restyle(tv)
            parent.onEndEditing?()
        }

        func textViewDidChangeSelection(_ tv: UITextView) {
            guard tv.isFirstResponder else { return }
            let now = lineRange(tv)
            if now != activeLine {
                activeLine = now
                restyle(tv)
            }
        }

        func textViewDidChange(_ tv: UITextView) {
            activeLine = lineRange(tv)
            restyle(tv)
            parent.text = tv.text
        }

        /// Return in a list item starts the next one; return on an empty item ends the list.
        func textView(_ tv: UITextView, shouldChangeTextIn range: NSRange, replacementText string: String) -> Bool {
            guard string == "\n", let edit = MarkdownTyping.returnPressed(in: tv.text, at: range) else { return true }
            tv.textStorage.replaceCharacters(in: edit.range, with: NSAttributedString(string: edit.replacement, attributes: MDStyle.base))
            tv.selectedRange = NSRange(location: edit.cursor, length: 0)
            textViewDidChange(tv)
            return false
        }

        private func replace(_ range: NSRange, with s: String, in tv: UITextView, cursorAt: Int? = nil) {
            tv.textStorage.replaceCharacters(in: range, with: NSAttributedString(string: s, attributes: MDStyle.base))
            tv.selectedRange = NSRange(location: cursorAt ?? range.location + (s as NSString).length, length: 0)
            textViewDidChange(tv)
        }

        // MARK: Drawing bullets and tick boxes

        nonisolated func textLayoutManager(_ textLayoutManager: NSTextLayoutManager, textLayoutFragmentFor location: NSTextLocation,
                                           in textElement: NSTextElement) -> NSTextLayoutFragment {
            if let p = textElement as? NSTextParagraph, p.attributedString.length > 0,
               let mark = p.attributedString.attribute(.mdMarker, at: 0, effectiveRange: nil) as? String {
                return MarkerFragment(textElement: p, range: p.elementRange, marker: mark)
            }
            return NSTextLayoutFragment(textElement: textElement, range: textElement.elementRange)
        }

        // MARK: Ticking checklist boxes

        /// Only a tap on a drawn tick box is ours; everything else goes to the text view as usual.
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard let tv = textView else { return false }
            return checkboxLine(at: touch.location(in: tv), in: tv) != nil
        }

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool { true }

        /// The line number of a checklist item whose box (or, on the editing line, whose [ ] marks) is at `point`.
        private func checkboxLine(at point: CGPoint, in tv: UITextView) -> Int? {
            guard point.x <= MDStyle.listIndent + Space.s, let pos = tv.closestPosition(to: point) else { return nil }
            let index = tv.offset(from: tv.beginningOfDocument, to: pos)
            let ns = tv.text as NSString
            let lineRange = ns.lineRange(for: NSRange(location: min(index, ns.length), length: 0))
            let line = ns.substring(with: lineRange)
            guard line.range(of: #"^\s*[-*+] \[( |x|X)\]"#, options: .regularExpression) != nil else { return nil }
            return ns.substring(to: lineRange.location).components(separatedBy: "\n").count - 1
        }

        @objc func tapped(_ g: UITapGestureRecognizer) {
            guard let tv = textView, let lineNo = checkboxLine(at: g.location(in: tv), in: tv) else { return }
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
            let bar = FormatBar(hasPhoto: parent.onPhoto != nil, act: { [weak self] action in self?.perform(action) })
            let host = UIHostingController(rootView: bar)
            host.view.backgroundColor = .clear
            host.view.frame = CGRect(x: 0, y: 0, width: 320, height: Size.tap + Space.s)
            host.view.autoresizingMask = [.flexibleWidth]
            host.sizingOptions = []
            return host.view
        }

        func perform(_ action: FormatBar.Action) {
            guard let tv = textView else { return }
            switch action {
            case .h1: linePrefix("# ")
            case .h2: linePrefix("## ")
            case .h3: linePrefix("### ")
            case .body: linePrefix("")
            case .quote: linePrefix("> ")
            case .code: wrap("`", "`")
            case .divider: insertBlock("---")
            case .bold: wrap("**", "**")
            case .italic: wrap("*", "*")
            case .strike: wrap("~~", "~~")
            case .bullets: linePrefix("- ")
            case .numbers: linePrefix("1. ")
            case .checklist: linePrefix("- [ ] ")
            case .link:
                let r = tv.selectedRange
                let selected = (tv.text as NSString).substring(with: r)
                let pasted = UIPasteboard.general.hasURLs ? UIPasteboard.general.url?.absoluteString ?? "" : ""
                let s = "[\(selected.isEmpty ? "link" : selected)](\(pasted))"
                replace(r, with: s, in: tv, cursorAt: pasted.isEmpty ? r.location + (s as NSString).length - 1 : nil)
            case .photo: parent.onPhoto?()
            case .done: tv.resignFirstResponder()
            }
        }

        func wrap(_ a: String, _ b: String) {
            guard let tv = textView else { return }
            let r = tv.selectedRange
            let selected = (tv.text as NSString).substring(with: r)
            replace(r, with: a + selected + b, in: tv, cursorAt: selected.isEmpty ? r.location + (a as NSString).length : nil)
        }

        /// Sets the current line's block mark (heading, list, quote), replacing any it had.
        func linePrefix(_ prefix: String) {
            guard let tv = textView else { return }
            let edit = MarkdownTyping.setLinePrefix(prefix, in: tv.text, at: tv.selectedRange.location)
            replace(edit.range, with: edit.replacement, in: tv, cursorAt: edit.cursor)
        }

        func insertBlock(_ s: String) {
            guard let tv = textView else { return }
            let r = tv.selectedRange
            let before = r.location > 0 ? (tv.text as NSString).substring(with: NSRange(location: r.location - 1, length: 1)) : "\n"
            replace(r, with: (before == "\n" ? "" : "\n") + s + "\n", in: tv)
        }

        /// Puts a photo's Markdown where the cursor is.
        func insertImage(_ markdown: String) { insertBlock(markdown) }
    }
}

/// Draws a list item's bullet, tick box or quote bar in the space the hidden marks leave.
final class MarkerFragment: NSTextLayoutFragment, @unchecked Sendable {
    let marker: String

    init(textElement: NSTextElement, range: NSTextRange?, marker: String) {
        self.marker = marker
        super.init(textElement: textElement, range: range)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override var renderingSurfaceBounds: CGRect {
        super.renderingSurfaceBounds.union(CGRect(x: -layoutFragmentFrame.minX, y: 0, width: MDStyle.listIndent + 4, height: layoutFragmentFrame.height))
    }

    override func draw(at point: CGPoint, in context: CGContext) {
        super.draw(at: point, in: context)
        guard let first = textLineFragments.first else { return }
        let lineMidY = point.y + first.typographicBounds.midY
        let indentX = point.x - layoutFragmentFrame.minX + markerIndent
        UIGraphicsPushContext(context)
        defer { UIGraphicsPopContext() }
        switch marker {
        case "check", "checked":
            let on = marker == "checked"
            let config = UIImage.SymbolConfiguration(pointSize: 17, weight: .regular)
            let image = UIImage(systemName: on ? "checkmark.square.fill" : "square", withConfiguration: config)?
                .withTintColor(on ? MDStyle.ink : MDStyle.icon, renderingMode: .alwaysOriginal)
            if let image {
                image.draw(at: CGPoint(x: indentX, y: lineMidY - image.size.height / 2))
            }
        case "bullet":
            let d: CGFloat = 5.5
            MDStyle.muted.setFill()
            UIBezierPath(ovalIn: CGRect(x: indentX + 5, y: lineMidY - d / 2, width: d, height: d)).fill()
        case "quote":
            MDStyle.stroke.setFill()
            UIBezierPath(roundedRect: CGRect(x: point.x - layoutFragmentFrame.minX, y: point.y, width: 3, height: layoutFragmentFrame.height), cornerRadius: 1.5).fill()
        default:
            break
        }
    }

    /// Nested items draw their marker further in, matching their text.
    private var markerIndent: CGFloat {
        guard let p = textElement as? NSTextParagraph,
              let style = p.attributedString.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle else { return 0 }
        return style.headIndent - MDStyle.listIndent
    }
}

extension NSAttributedString.Key {
    /// Set on the first character of a list or quote line that should get a drawn marker.
    static let mdMarker = NSAttributedString.Key("lukeos.mdMarker")
}

/// The typing rules, as plain functions so they can be tested.
enum MarkdownTyping {
    struct Edit: Equatable {
        var range: NSRange
        var replacement: String
        var cursor: Int
    }

    /// What Return does at `range`: continue a list or quote, or end it on an empty item. nil means a plain newline.
    static func returnPressed(in text: String, at range: NSRange) -> Edit? {
        let ns = text as NSString
        let lineRange = ns.lineRange(for: NSRange(location: range.location, length: 0))
        let line = ns.substring(with: lineRange).trimmingCharacters(in: .newlines)
        guard let m = line.firstMatch(of: /^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)[.)] |> )(.*)$/) else { return nil }
        if m.4.isEmpty {
            // An empty item ends the list: take its mark away.
            let markLength = (String(m.1) + String(m.2) as NSString).length
            return Edit(range: NSRange(location: lineRange.location, length: markLength), replacement: "", cursor: lineRange.location)
        }
        var marker = String(m.2)
        if let n = m.3.flatMap({ Int($0) }) { marker = "\(n + 1)" + String(m.2.dropFirst(String(n).count)) }
        marker = marker.replacingOccurrences(of: "[x]", with: "[ ]").replacingOccurrences(of: "[X]", with: "[ ]")
        let insert = "\n" + m.1 + marker
        return Edit(range: range, replacement: insert, cursor: range.location + (insert as NSString).length)
    }

    /// Sets a line's block mark, replacing any it had; the same mark again takes it off.
    static func setLinePrefix(_ prefix: String, in text: String, at location: Int) -> Edit {
        let ns = text as NSString
        let lineRange = ns.lineRange(for: NSRange(location: min(location, ns.length), length: 0))
        let line = ns.substring(with: lineRange).trimmingCharacters(in: .newlines)
        let bare = line.replacingOccurrences(of: #"^(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )"#, with: "", options: .regularExpression)
        let current = String(line.dropLast(bare.count))
        let next = current == prefix ? bare : prefix + bare
        return Edit(range: NSRange(location: lineRange.location, length: (line as NSString).length), replacement: next,
                    cursor: lineRange.location + (next as NSString).length)
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

/// How Markdown looks while it's being written. The text is never changed, only styled.
enum MDStyle {
    static func font(_ name: String, _ size: CGFloat, _ style: UIFont.TextStyle = .body) -> UIFont {
        UIFontMetrics(forTextStyle: style).scaledFont(for: UIFont(name: name, size: size) ?? .systemFont(ofSize: size))
    }

    private static func dyn(_ light: UInt32, _ dark: UInt32) -> UIColor {
        UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) }
    }

    static let text = dyn(0x424242, 0xCECECE)
    static let ink = dyn(0x121212, 0xF5F5F5)
    static let quiet = dyn(0xA4A4A4, 0x5D5D5D)
    static let muted = dyn(0x636363, 0xA4A4A4)
    static let icon = dyn(0x808080, 0x7D7D7D)
    static let stroke = dyn(0xD9D9D9, 0x353535)
    static let codeBack = dyn(0xF2F2F2, 0x222222)

    /// Room on the left for a bullet or tick box.
    static let listIndent: CGFloat = 26
    static let bodySize = LukeType.body.size

    static var paragraph: NSParagraphStyle {
        let p = NSMutableParagraphStyle()
        p.lineSpacing = 5
        p.paragraphSpacing = 4
        return p
    }

    static var base: [NSAttributedString.Key: Any] {
        [.font: font("Geist-Regular", bodySize), .foregroundColor: text, .paragraphStyle: paragraph]
    }

    /// Marks on other lines take no room and can't be seen.
    static var hidden: [NSAttributedString.Key: Any] {
        [.font: UIFont.systemFont(ofSize: 0.01), .foregroundColor: UIColor.clear, .kern: 0]
    }

    private static func indented(_ level: Int, extra: CGFloat = 0) -> NSParagraphStyle {
        let p = NSMutableParagraphStyle()
        p.lineSpacing = 5
        p.paragraphSpacing = 4
        p.firstLineHeadIndent = listIndent * CGFloat(level + 1) + extra
        p.headIndent = listIndent * CGFloat(level + 1) + extra
        return p
    }

    /// The whole text, styled. `activeLine` is the line being edited, whose marks stay visible (dimmed).
    static func styled(_ s: String, activeLine: NSRange? = nil) -> NSAttributedString {
        let out = NSMutableAttributedString(string: s, attributes: base)
        let ns = s as NSString
        var inCode = false
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: [.byLines, .substringNotRequired]) { _, lineRange, enclosing, _ in
            let line = ns.substring(with: lineRange)
            let active = activeLine.map { NSIntersectionRange($0, enclosing).length > 0 || ($0.location == enclosing.location) } ?? false
            func dim(_ r: NSRange) { out.addAttributes(active ? [.foregroundColor: quiet] : hidden, range: r) }
            func mark(_ r: NSRange) { out.addAttribute(.foregroundColor, value: quiet, range: r) }
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if line.isEmpty && !active && !inCode {
                // A blank line between blocks is a small gap, not a whole line; full height while being typed on.
                let p = NSMutableParagraphStyle()
                p.minimumLineHeight = Space.s
                p.maximumLineHeight = Space.s
                p.paragraphSpacing = 0
                out.addAttributes([.paragraphStyle: p, .font: UIFont.systemFont(ofSize: Space.s / 2)], range: enclosing)
                return
            }
            if trimmed.hasPrefix("```") {
                inCode.toggle()
                out.addAttributes([.font: font("GeistMono-Regular", 14), .foregroundColor: quiet], range: lineRange)
                return
            }
            if inCode {
                out.addAttributes([.font: font("GeistMono-Regular", 14), .backgroundColor: codeBack], range: lineRange)
                return
            }
            if let m = line.firstMatch(of: #/^(#{1,6}) /#) {
                let level = m.1.count
                let size: CGFloat = level == 1 ? LukeType.section.size + 2 : level == 2 ? LukeType.heading.size + 1 : LukeType.heading.size
                let p = NSMutableParagraphStyle()
                // More room above a heading than below, so it belongs to what follows.
                p.paragraphSpacingBefore = Space.xl
                p.paragraphSpacing = Space.s
                out.addAttributes([.font: font("Geist-Medium", size, .title2), .foregroundColor: ink, .kern: -0.04 * size, .paragraphStyle: p], range: lineRange)
                dim(NSRange(location: lineRange.location, length: level + 1))
                inline(out, line: line, at: lineRange.location, active: active)
                return
            }
            if line.hasPrefix("|") {
                // Tables are shown and edited elsewhere; if one reaches here, keep it plain and quiet.
                out.addAttributes([.font: font("GeistMono-Regular", 14), .foregroundColor: muted], range: lineRange)
                return
            }
            let level = (line.prefix { $0 == " " }.count) / 2
            if let m = line.firstMatch(of: /^(\s*[-*+] \[([ xX])\] )/) {
                let len = (String(m.1) as NSString).length
                let on = m.2 != " "
                dim(NSRange(location: lineRange.location, length: len))
                if !active {
                    out.addAttribute(.paragraphStyle, value: indented(level), range: lineRange)
                    out.addAttribute(.mdMarker, value: on ? "checked" : "check", range: NSRange(location: lineRange.location, length: 1))
                }
                if on {
                    out.addAttributes([.strikethroughStyle: NSUnderlineStyle.single.rawValue, .foregroundColor: muted],
                                      range: NSRange(location: lineRange.location + len, length: lineRange.length - len))
                }
            } else if let m = line.firstMatch(of: /^(\s*[-*+] )/) {
                dim(NSRange(location: lineRange.location, length: (String(m.1) as NSString).length))
                if !active {
                    out.addAttribute(.paragraphStyle, value: indented(level), range: lineRange)
                    out.addAttribute(.mdMarker, value: "bullet", range: NSRange(location: lineRange.location, length: 1))
                }
            } else if let m = line.firstMatch(of: /^(\s*\d+[.)] )/) {
                mark(NSRange(location: lineRange.location, length: (String(m.1) as NSString).length))
            } else if line.hasPrefix(">") {
                let len = line.hasPrefix("> ") ? 2 : 1
                out.addAttributes([.font: font("Geist-Italic", bodySize), .foregroundColor: muted], range: lineRange)
                dim(NSRange(location: lineRange.location, length: len))
                if !active {
                    out.addAttribute(.paragraphStyle, value: indented(-1, extra: 14), range: lineRange)
                    out.addAttribute(.mdMarker, value: "quote", range: NSRange(location: lineRange.location, length: 1))
                }
            } else if trimmed == "---" || trimmed == "***" {
                mark(lineRange)
                return
            } else if line.hasPrefix("![") {
                out.addAttributes([.font: font("GeistMono-Regular", 13), .foregroundColor: muted], range: lineRange)
                return
            }
            inline(out, line: line, at: lineRange.location, active: active)
        }
        return out
    }

    private static func inline(_ out: NSMutableAttributedString, line: String, at offset: Int, active: Bool) {
        let ns = line as NSString
        func each(_ pattern: String, _ body: (NSTextCheckingResult) -> Void) {
            guard let re = try? NSRegularExpression(pattern: pattern) else { return }
            for m in re.matches(in: line, range: NSRange(location: 0, length: ns.length)) { body(m) }
        }
        func shift(_ r: NSRange) -> NSRange { NSRange(location: r.location + offset, length: r.length) }
        func hideMarks(_ m: NSTextCheckingResult, _ n: Int) {
            let attrs: [NSAttributedString.Key: Any] = active ? [.foregroundColor: quiet] : hidden
            out.addAttributes(attrs, range: shift(NSRange(location: m.range.location, length: n)))
            out.addAttributes(attrs, range: shift(NSRange(location: NSMaxRange(m.range) - n, length: n)))
        }
        each(#"\*\*[^*\n]+\*\*|__[^_\n]+__"#) { m in
            let size = (out.attribute(.font, at: shift(m.range).location, effectiveRange: nil) as? UIFont)?.pointSize ?? bodySize
            out.addAttributes([.font: font("Geist-Medium", max(size, bodySize)), .foregroundColor: ink], range: shift(m.range))
            hideMarks(m, 2)
        }
        each(#"(?<![*\w])\*[^*\n]+\*(?!\*)|(?<![_\w])_[^_\n]+_(?!_)"#) { m in
            out.addAttribute(.font, value: font("Geist-Italic", bodySize), range: shift(m.range))
            hideMarks(m, 1)
        }
        each(#"~~[^~\n]+~~"#) { m in
            out.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: shift(m.range))
            hideMarks(m, 2)
        }
        each(#"`[^`\n]+`"#) { m in
            out.addAttributes([.font: font("GeistMono-Regular", 14.5), .backgroundColor: codeBack], range: shift(m.range))
            hideMarks(m, 1)
        }
        each(#"(?<!!)\[([^\]\n]+)\]\(([^)\n]*)\)"#) { m in
            let attrs: [NSAttributedString.Key: Any] = active ? [.foregroundColor: quiet] : hidden
            let text = m.range(at: 1)
            out.addAttributes(attrs, range: shift(NSRange(location: m.range.location, length: 1)))
            out.addAttributes(attrs, range: shift(NSRange(location: NSMaxRange(text), length: NSMaxRange(m.range) - NSMaxRange(text))))
            out.addAttributes([.foregroundColor: ink, .underlineStyle: NSUnderlineStyle.single.rawValue], range: shift(text))
        }
    }
}
