import Foundation

/// Due dates are plain calendar days ("2026-10-02"). These helpers work on those strings,
/// the same way as the web app's `src/lib/dates.ts`, so nothing shifts across time zones.
enum Day {
    private static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private static let weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    static func date(_ day: String) -> Date {
        let p = day.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return .now }
        return utc.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))!
    }

    static func string(_ date: Date) -> String {
        let c = utc.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// Today in a time zone (the device's by default).
    static func today(in timeZone: TimeZone = .current, now: Date = .now) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let c = cal.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// A calendar Date picked in the device's zone, as a day string.
    static func fromLocal(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// A day string as a Date at local midnight, for date pickers.
    static func toLocal(_ day: String) -> Date {
        let p = day.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return .now }
        return Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) ?? .now
    }

    static func add(_ day: String, days n: Int) -> String {
        string(utc.date(byAdding: .day, value: n, to: date(day))!)
    }

    /// The same day of the month, n months on; the 31st becomes the last day of a shorter month.
    static func add(_ day: String, months n: Int) -> String {
        string(utc.date(byAdding: .month, value: n, to: date(day))!)
    }

    static func weekday(_ day: String) -> Int { utc.component(.weekday, from: date(day)) - 1 } // 0 = Sunday

    static func between(_ from: String, _ to: String) -> Int {
        Int((date(to).timeIntervalSince(date(from)) / 86_400).rounded())
    }

    /// The Sunday that ends the week (weeks run Monday to Sunday).
    static func endOfWeek(_ day: String) -> String {
        add(day, days: 6 - (weekday(day) + 6) % 7)
    }

    static func endOfMonth(_ day: String) -> String {
        let d = date(day)
        let range = utc.range(of: .day, in: .month, for: d)!
        var c = utc.dateComponents([.year, .month], from: d)
        c.day = range.count
        return string(utc.date(from: c)!)
    }

    /// "30 Sep 2026"
    static func short(_ day: String) -> String {
        let d = date(day)
        return "\(utc.component(.day, from: d)) \(months[utc.component(.month, from: d) - 1]) \(utc.component(.year, from: d))"
    }

    /// "4 Oct"
    static func dayAndMonth(_ day: String) -> String {
        let d = date(day)
        return "\(utc.component(.day, from: d)) \(months[utc.component(.month, from: d) - 1])"
    }

    /// "Today", "Tomorrow", "Yesterday", "Fri", "Thu 8 Oct" or "8 Oct 2027".
    static func friendly(_ day: String, today: String) -> String {
        let diff = between(today, day)
        if diff == 0 { return "Today" }
        if diff == 1 { return "Tomorrow" }
        if diff == -1 { return "Yesterday" }
        if diff > 1 && diff < 7 { return weekdays[weekday(day)] }
        if day.prefix(4) == today.prefix(4) { return "\(weekdays[weekday(day)]) \(dayAndMonth(day))" }
        return short(day)
    }

    /// "Sun 4 Oct"
    static func weekdayDayAndMonth(_ day: String) -> String { "\(weekdays[weekday(day)]) \(dayAndMonth(day))" }

    static func isLate(_ due: String?, today: String) -> Bool { (due ?? "9999") < today }

    /// The list a due date points to (used when a task is first made).
    static func bucket(for due: String?, today: String) -> Bucket {
        guard let due else { return .today }
        if due <= today { return .today }
        let tomorrow = add(today, days: 1)
        if due == tomorrow { return .tomorrow }
        let weekEnd = endOfWeek(today) > tomorrow ? endOfWeek(today) : endOfWeek(add(today, days: 2))
        return due <= weekEnd ? .this_week : .later
    }
}

/// Timestamps from the server: ISO strings with milliseconds.
enum Stamp {
    static func date(_ s: String?) -> Date? {
        guard let s else { return nil }
        return ISO8601DateFormatter.withFractional.date(from: s) ?? ISO8601DateFormatter.plain.date(from: s)
    }

    /// "2m", "3h", "Yesterday", "Mon", "4 Oct".
    static func relative(_ s: String?) -> String {
        guard let d = date(s) else { return "" }
        let secs = Date.now.timeIntervalSince(d)
        if secs < 60 { return "Now" }
        if secs < 3600 { return "\(Int(secs / 60))m" }
        if Calendar.current.isDateInToday(d) { return d.formatted(date: .omitted, time: .shortened) }
        if Calendar.current.isDateInYesterday(d) { return "Yesterday" }
        if secs < 6 * 86_400 { return d.formatted(.dateTime.weekday(.abbreviated)) }
        if Calendar.current.isDate(d, equalTo: .now, toGranularity: .year) { return d.formatted(.dateTime.day().month(.abbreviated)) }
        return d.formatted(.dateTime.day().month(.abbreviated).year())
    }

    static func day(_ s: String?) -> String? {
        guard let d = date(s) else { return nil }
        return Day.fromLocal(d)
    }
}
