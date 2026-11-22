import Foundation

/// Reads a due date, a repeat and a list out of a task name as it's typed, the same rules as the
/// web app's `src/lib/smart-entry.ts`: "put away laundry tomorrow" becomes "put away laundry", due tomorrow.
struct SmartEntry: Equatable, Sendable {
    enum Kind: String, Sendable { case date, `repeat`, list }
    struct Match: Equatable, Sendable {
        var kind: Kind
        var range: Range<String.Index>
        var text: String
    }

    var title: String
    var dueDate: String?
    var `repeat`: String?
    var bucket: Bucket?
    var matches: [Match]

    private struct Found { var dueDate: String?; var `repeat`: String?; var bucket: Bucket? }
    private struct Rule { var kind: Kind; var re: NSRegularExpression; var read: ([String?], String) -> Found? }

    private static let dayNames: [String: Int] = [
        "sunday": 0, "sun": 0, "monday": 1, "mon": 1, "tuesday": 2, "tues": 2, "tue": 2, "wednesday": 3, "weds": 3, "wed": 3,
        "thursday": 4, "thurs": 4, "thur": 4, "thu": 4, "friday": 5, "fri": 5, "saturday": 6, "sat": 6,
    ]
    private static let monthNames: [String: Int] = [
        "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3, "april": 4, "apr": 4, "may": 5,
        "june": 6, "jun": 6, "july": 7, "jul": 7, "august": 8, "aug": 8, "september": 9, "sept": 9, "sep": 9,
        "october": 10, "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
    ]
    private static let numberWords: [String: Int] = [
        "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    ]

    private static let DAY_FULL = "monday|tuesday|wednesday|thursday|friday|saturday|sunday"
    private static let DAY_ANY = "\(DAY_FULL)|mon|tues|tue|weds|wed|thurs|thur|thu|fri|sat|sun"
    private static let DAY_SAFE = "\(DAY_FULL)|mon|tues|tue|weds|wed|thurs|thur|thu|fri"
    private static let MONTH = monthNames.keys.sorted { $0.count > $1.count }.joined(separator: "|")
    private static let ORD = "(?:st|nd|rd|th)"
    private static let COUNT = "\\d+|" + ["a", "an", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"].joined(separator: "|")
    private static let LEAD = "(?:(?:due(?:\\s+(?:on|by))?|on|by|for|before|until|from|starting(?:\\s+(?:on|from))?)\\s+)?"
    private static let ADJ_END = "(?=\\s*(?:$|[,.;!?]|(?:on|by|from|starting|until|due|today|tonight|tomorrow|this|next|every|in)(?![\\w'])))"
    private static let COUNT_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten"
    private static let GAP = "other|second|third|couple\\s+(?:of\\s+)?|\\d{1,3}\(ORD)?|\(COUNT_WORDS)"
    private static let DAY_GAP = "other|second|\\d{1,2}|\(COUNT_WORDS)"

    private static func rx(_ body: String) -> NSRegularExpression {
        try! NSRegularExpression(pattern: "(?<![\\w'])(?:\(body))(?![\\w'])", options: [.caseInsensitive])
    }

    private static func upcoming(_ today: String, _ day: Int) -> String {
        Day.add(today, days: (day - Day.weekday(today) + 7) % 7)
    }
    private static func inNextWeek(_ today: String, _ day: Int) -> String {
        Day.add(Day.endOfWeek(today), days: day == 0 ? 7 : day)
    }
    private static func pad(_ n: Int) -> String { String(format: "%02d", n) }

    private static func nextDayOfMonth(_ today: String, _ dom: Int) -> String? {
        guard (1...31).contains(dom) else { return nil }
        let p = today.split(separator: "-").compactMap { Int($0) }
        for i in 0..<13 {
            let first = Day.add("\(p[0])-\(pad(p[1]))-01", months: i)
            let day = "\(first.prefix(8))\(pad(dom))"
            if day >= today && Day.endOfMonth(first) >= day { return day }
        }
        return nil
    }

    private static func monthDay(_ today: String, _ month: Int, _ dom: Int, _ year: Int? = nil) -> String? {
        guard (1...12).contains(month), dom >= 1 else { return nil }
        func build(_ y: Int) -> String? {
            let day = "\(y)-\(pad(month))-\(pad(dom))"
            return Day.endOfMonth("\(y)-\(pad(month))-01") >= day ? day : nil
        }
        if let year { return build(year < 100 ? 2000 + year : year) }
        let thisYear = Int(today.prefix(4))!
        if let day = build(thisYear), day >= today { return day }
        return build(thisYear + 1)
    }

    private static func count(_ w: String) -> Int { numberWords[w.lowercased()] ?? Int(w) ?? 0 }

    private static func gapCount(_ word: String) -> Int {
        var w = word.lowercased().replacingOccurrences(of: "\\s+(?:of\\s+)?$", with: "", options: .regularExpression)
        if w == "other" || w == "second" || w == "couple" { return 2 }
        if w == "third" { return 3 }
        w = w.replacingOccurrences(of: "(?<=\\d)(st|nd|rd|th)$", with: "", options: .regularExpression)
        return count(w)
    }

    private static func unitOf(_ w: String) -> String {
        var s = w.lowercased()
        if s.hasSuffix("s") { s.removeLast() }
        return s + "s"
    }

    nonisolated(unsafe) private static let rules: [Rule] = [
        Rule(kind: .repeat, re: rx("(?:every|each)\\s+(\(GAP))\\s*(day|week|month|year)s?")) { m, _ in
            let n = gapCount(m[1]!)
            return (1...365).contains(n) ? Found(repeat: Repeats.of(n, unitOf(m[2]!))) : nil
        },
        Rule(kind: .repeat, re: rx("(?:every|each)\\s+(\(DAY_GAP))\\s+(\(DAY_ANY))s?")) { m, t in
            let n = gapCount(m[1]!)
            guard (1...52).contains(n) else { return nil }
            return Found(dueDate: upcoming(t, dayNames[m[2]!.lowercased()]!), repeat: Repeats.of(n, "weeks"))
        },
        Rule(kind: .repeat, re: rx("(?:fortnightly|bi-?weekly)\(ADJ_END)|every\\s+fortnight")) { _, _ in Found(repeat: "every_2_weeks") },
        Rule(kind: .repeat, re: rx("every\\s+(?:week\\s*day|work\\s*day)s?|on\\s+weekdays|weekdays")) { _, _ in Found(repeat: "weekdays") },
        Rule(kind: .repeat, re: rx("(?:every|each)\\s+(\(DAY_ANY))s?|(?:on\\s+)?(\(DAY_FULL))s")) { m, t in
            Found(dueDate: upcoming(t, dayNames[(m[1] ?? m[2]!).lowercased()]!), repeat: "weekly")
        },
        Rule(kind: .repeat, re: rx("(?:every|each)\\s+(?:month\\s+on\\s+)?(?:the\\s+)?(\\d{1,2})\(ORD)(?:\\s+of\\s+(?:the|every)\\s+month)?|(?:on\\s+)?the\\s+(\\d{1,2})\(ORD)\\s+of\\s+(?:every|each)\\s+month")) { m, t in
            nextDayOfMonth(t, Int(m[1] ?? m[2]!) ?? 0).map { Found(dueDate: $0, repeat: "monthly") }
        },
        Rule(kind: .repeat, re: rx("(?:every|each)\\s+(\(MONTH))\\.?\\s+(\\d{1,2})\(ORD)?|(?:every|each)\\s+(\\d{1,2})\(ORD)?\\s+(?:of\\s+)?(\(MONTH))")) { m, t in
            let d = m[1] != nil
                ? monthDay(t, monthNames[m[1]!.lowercased()]!, Int(m[2]!)!)
                : monthDay(t, monthNames[m[4]!.lowercased()]!, Int(m[3]!)!)
            return d.map { Found(dueDate: $0, repeat: "yearly") }
        },
        Rule(kind: .repeat, re: rx("(?:every|each)\\s+(?:day|morning|evening|night)|every\\s*day|(?:daily|nightly)\(ADJ_END)")) { _, _ in Found(repeat: "daily") },
        Rule(kind: .repeat, re: rx("(?:every|each)\\s+week|weekly\(ADJ_END)")) { _, _ in Found(repeat: "weekly") },
        Rule(kind: .repeat, re: rx("(?:every|each)\\s+month|monthly\(ADJ_END)")) { _, _ in Found(repeat: "monthly") },
        Rule(kind: .repeat, re: rx("(?:every|each)\\s+year|(?:yearly|annually)\(ADJ_END)")) { _, _ in Found(repeat: "yearly") },

        Rule(kind: .date, re: rx("\(LEAD)(?:the\\s+)?day\\s+after\\s+tomorrow")) { _, t in Found(dueDate: Day.add(t, days: 2)) },
        Rule(kind: .date, re: rx("\(LEAD)(?:today|tonight|this\\s+(?:morning|afternoon|evening))")) { _, t in Found(dueDate: t) },
        Rule(kind: .date, re: rx("\(LEAD)(?:tomorrow|tmrw|tmr)(?:\\s+(?:morning|afternoon|evening|night))?")) { _, t in Found(dueDate: Day.add(t, days: 1)) },
        Rule(kind: .date, re: rx("\(LEAD)(?:(this|next)\\s+(\(DAY_ANY))|(\(DAY_SAFE)))")) { m, t in
            let day = dayNames[(m[2] ?? m[3]!).lowercased()]!
            return Found(dueDate: m[1]?.lowercased() == "next" ? inNextWeek(t, day) : upcoming(t, day))
        },
        Rule(kind: .date, re: rx("(?:due(?:\\s+(?:on|by))?|on|by|before|until)\\s+(sat|sun)")) { m, t in
            Found(dueDate: upcoming(t, dayNames[m[1]!.lowercased()]!))
        },
        Rule(kind: .date, re: rx("\(LEAD)(?:this\\s+|the\\s+)?weekend")) { _, t in
            Found(dueDate: Day.endOfWeek(t) == t ? t : Day.add(Day.endOfWeek(t), days: -1))
        },
        Rule(kind: .date, re: rx("\(LEAD)next\\s+week")) { _, t in Found(dueDate: Day.add(Day.endOfWeek(t), days: 1)) },
        Rule(kind: .date, re: rx("\(LEAD)next\\s+month")) { _, t in Found(dueDate: Day.add(Day.endOfMonth(t), days: 1)) },
        Rule(kind: .date, re: rx("\(LEAD)(?:(?:the\\s+)?end\\s+of\\s+(?:the\\s+|this\\s+)?week|eow)")) { _, t in Found(dueDate: Day.endOfWeek(t)) },
        Rule(kind: .date, re: rx("\(LEAD)(?:(?:the\\s+)?end\\s+of\\s+(?:the\\s+|this\\s+)?month|eom)")) { _, t in Found(dueDate: Day.endOfMonth(t)) },
        Rule(kind: .date, re: rx("\(LEAD)(?:in\\s+(\(COUNT))\\s+(day|week|month|year)s?|(\(COUNT))\\s+(day|week|month|year)s?\\s+from\\s+(?:now|today))")) { m, t in
            let n = count(m[1] ?? m[3]!)
            let unit = (m[2] ?? m[4]!).lowercased()
            guard n > 0, n <= 1000 else { return nil }
            switch unit {
            case "day": return Found(dueDate: Day.add(t, days: n))
            case "week": return Found(dueDate: Day.add(t, days: 7 * n))
            case "month": return Found(dueDate: Day.add(t, months: n))
            default: return Found(dueDate: Day.add(t, months: 12 * n))
            }
        },
        Rule(kind: .date, re: rx("\(LEAD)(?:(\(MONTH))\\.?\\s+(\\d{1,2})\(ORD)?(?:,?\\s+(\\d{4}))?|(?:the\\s+)?(\\d{1,2})\(ORD)?\\s+(?:of\\s+)?(\(MONTH))(?:,?\\s+(\\d{4}))?)")) { m, t in
            let d = m[1] != nil
                ? monthDay(t, monthNames[m[1]!.lowercased()]!, Int(m[2]!)!, m[3].flatMap { Int($0) })
                : monthDay(t, monthNames[m[5]!.lowercased()]!, Int(m[4]!)!, m[6].flatMap { Int($0) })
            return d.map { Found(dueDate: $0) }
        },
        Rule(kind: .date, re: rx("\(LEAD)(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?")) { m, t in
            monthDay(t, Int(m[1]!)!, Int(m[2]!)!, m[3].flatMap { Int($0) }).map { Found(dueDate: $0) }
        },
        Rule(kind: .date, re: rx("\(LEAD)the\\s+(\\d{1,2})\(ORD)")) { m, t in
            nextDayOfMonth(t, Int(m[1]!)!).map { Found(dueDate: $0) }
        },

        Rule(kind: .list, re: rx("(?:(?:later|sometime|for)\\s+)?this\\s+week")) { _, _ in Found(bucket: .this_week) },
        Rule(kind: .list, re: rx("(?:for\\s+)?later")) { _, _ in Found(bucket: .later) },
    ]

    /// Finds the first date, repeat and list in `text`. Words in `ignore` (lower case) are left alone.
    static func parse(_ text: String, today: String, ignore: Set<String> = []) -> SmartEntry {
        let ns = text as NSString
        var found: [(kind: Kind, range: NSRange, text: String, f: Found)] = []
        func free(_ r: NSRange) -> Bool {
            found.allSatisfy { NSMaxRange(r) <= $0.range.location || r.location >= NSMaxRange($0.range) }
        }
        for rule in rules where !found.contains(where: { $0.kind == rule.kind }) {
            for m in rule.re.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
                let whole = ns.substring(with: m.range)
                if ignore.contains(whole.lowercased()) || !free(m.range) { continue }
                let groups: [String?] = (0..<m.numberOfRanges).map {
                    let r = m.range(at: $0)
                    return r.location == NSNotFound ? nil : ns.substring(with: r)
                }
                guard let result = rule.read(groups, today) else { continue }
                found.append((rule.kind, m.range, whole, result))
                break
            }
        }
        let rep = found.first { $0.kind == .repeat }
        let date = found.first { $0.kind == .date }
        let list = found.first { $0.kind == .list }
        let sorted = found.sorted { $0.range.location < $1.range.location }
        var title = ns
        for m in sorted.reversed() { title = title.replacingCharacters(in: m.range, with: " ") as NSString }
        var cleaned = (title as String)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "\\s+([,.;:!?])", with: "$1", options: .regularExpression)
            .replacingOccurrences(of: "^[\\s,;:–—-]+|[\\s,;:–—-]+$", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        if sorted.isEmpty { cleaned = text.trimmingCharacters(in: .whitespaces) }
        let matches = sorted.compactMap { m -> Match? in
            guard let r = Range(m.range, in: text) else { return nil }
            return Match(kind: m.kind, range: r, text: m.text)
        }
        return SmartEntry(title: cleaned, dueDate: date?.f.dueDate ?? rep?.f.dueDate, repeat: rep?.f.repeat,
                          bucket: list?.f.bucket, matches: matches)
    }
}
