import SwiftUI
import UIKit

/// Luke's design system: a pure grey scale with the same step names in light and dark,
/// Geist type in regular and medium only, and colour only where it means something
/// (red count badges, blue unread dots, project colours).
enum Grey {
    private static func step(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }

    static let g0 = step(0xFFFFFF, 0x121212)
    static let g50 = step(0xF8F8F8, 0x191919)
    static let g100 = step(0xF2F2F2, 0x222222)
    static let g200 = step(0xE8E8E8, 0x2B2B2B)
    static let g300 = step(0xD9D9D9, 0x353535)
    static let g400 = step(0xC1C1C1, 0x454545)
    static let g500 = step(0xA4A4A4, 0x5D5D5D)
    static let g600 = step(0x808080, 0x7D7D7D)
    static let g700 = step(0x636363, 0xA4A4A4)
    static let g800 = step(0x424242, 0xCECECE)
    static let g900 = step(0x262626, 0xE8E8E8)
    static let g950 = step(0x121212, 0xF5F5F5)
    static let onSolid = step(0xFFFFFF, 0x121212)
}

extension Color {
    /// The page. Light: step 50 so white cards sit a step lighter; dark: step 0.
    static let page = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0x121212) : UIColor(hex: 0xF8F8F8) })
    /// A card: always a step lighter than the page under it.
    static let card = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0x191919) : UIColor(hex: 0xFFFFFF) })
    /// Something raised inside a card (inputs, chips): one more step.
    static let raised = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0x222222) : UIColor(hex: 0xF2F2F2) })
    static let muted = Grey.g100
    static let selected = Grey.g200
    static let hairline = Grey.g200
    static let stroke = Grey.g300
    static let strokeStrong = Grey.g400
    static let disabled = Grey.g500
    static let icon = Grey.g600
    static let mutedText = Grey.g700
    static let subtleText = Grey.g800
    static let text = Grey.g900
    static let ink = Grey.g950
    static let onSolid = Grey.onSolid
    /// Swipe action backgrounds: dark grey for the main action, mid grey for the rest.
    static let swipePrimary = Color(UIColor(hex: 0x262626))
    static let swipeSecondary = Color(UIColor(hex: 0x808080))
    static let notification = Color(UIColor(hex: 0xD92D20))
    static let unread = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0x4C8DF6) : UIColor(hex: 0x2563EB) })

    /// A project's colour by its stored name.
    static func project(_ name: String?) -> Color {
        let hex: UInt32 = switch name {
        case "orange": 0xEA580C
        case "blue": 0x2563EB
        case "violet": 0x7C3AED
        case "teal": 0x0D9488
        case "pink": 0xDB2777
        case "green": 0x16A34A
        case "amber": 0xD97706
        default: 0x64748B
        }
        return Color(UIColor(hex: hex))
    }

    init(hexString: String) {
        let s = hexString.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        self = Color(UIColor(hex: UInt32(s, radix: 16) ?? 0x64748B))
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

// MARK: Type

/// The type scale from the web app. Anything bigger than 16pt is drawn 4% tighter.
enum LukeType {
    case tag, meta, preview, control, body, heading, section, title, display

    var size: CGFloat {
        switch self {
        case .tag: 13
        case .meta: 14
        case .preview: 15
        case .control: 16
        case .body: 16
        case .heading: 18
        case .section: 22
        case .title: 28
        case .display: 40
        }
    }

    var relativeTo: Font.TextStyle {
        switch self {
        case .tag: .caption
        case .meta: .footnote
        case .preview: .subheadline
        case .control: .callout
        case .body: .body
        case .heading: .headline
        case .section: .title2
        case .title: .title
        case .display: .largeTitle
        }
    }

    var tracking: CGFloat { size > 16 ? -0.04 * size : 0 }
    var lineSpacing: CGFloat { self == .body ? size * 0.4 : size * 0.2 }
}

extension Font {
    /// Geist at a step of the type scale. `medium` is the only heavier weight in the system.
    static func geist(_ style: LukeType, medium: Bool = false) -> Font {
        .custom(medium ? "Geist-Medium" : "Geist-Regular", size: style.size, relativeTo: style.relativeTo)
    }

    static func geist(size: CGFloat, medium: Bool = false) -> Font {
        .custom(medium ? "Geist-Medium" : "Geist-Regular", size: size)
    }

    static func geistMono(size: CGFloat) -> Font { .custom("GeistMono-Regular", size: size) }

    /// Geist Mono at a step of the type scale (codes, times, code blocks).
    static func geistMono(_ style: LukeType) -> Font { .custom("GeistMono-Regular", size: style.size, relativeTo: style.relativeTo) }
}

extension View {
    /// Text in a step of the type scale, with its tracking.
    func textStyle(_ style: LukeType, medium: Bool = false, color: Color? = nil) -> some View {
        self.font(.geist(style, medium: medium))
            .tracking(style.tracking)
            .foregroundStyle(color ?? (medium && style.size > 16 ? Color.ink : Color.subtleText))
    }
}

// MARK: Shape

/// Space between things, so screens can breathe (Luke, 22 Nov 2026). Screens use these, never numbers.
enum Space {
    static let xs: CGFloat = 4
    static let s: CGFloat = 8
    static let m: CGFloat = 12
    static let l: CGFloat = 16
    static let xl: CGFloat = 20
    static let xxl: CGFloat = 24
    static let section: CGFloat = 32
    /// Between a title and its second line.
    static let line: CGFloat = 6
    /// Above and below the text in a row.
    static let row: CGFloat = 14
    /// Card inner padding at the sides.
    static let inset: CGFloat = 16
    /// Page side margins outside lists.
    static let page: CGFloat = 20
    /// Height of a chip or tag.
    static let chip: CGFloat = Size.chip
}

/// Fixed sizes of components.
enum Size {
    static let tick: CGFloat = 24
    static let tap: CGFloat = 44
    static let chip: CGFloat = 26
    static let rowMin: CGFloat = 52
    static let artworkRow: CGFloat = 54
    static let artworkMini: CGFloat = 32
    static let artworkPlayer: CGFloat = 260
    static let transportMain: CGFloat = 76
    static let transportSide: CGFloat = 52
    static let fab: CGFloat = 60
    static let focusRing: CGFloat = 260
    static let focusRingStroke: CGFloat = 10
    /// The time inside the focus ring: bigger than `display`, so it holds the ring.
    static let focusTime: CGFloat = 60
    static let field: CGFloat = 52
    static let unreadDot: CGFloat = 8
    static let projectDot: CGFloat = 9
    /// Room at the bottom of a scrolling screen so the last thing clears the tab bar and mini player.
    static let bottomClearance: CGFloat = 110
    /// Width of the icon column at the start of a row (so titles line up).
    static let iconColumn: CGFloat = 28
    /// The tick's column in a task row.
    static let tickColumn: CGFloat = 30
    /// Small round buttons in bars and sheets.
    static let smallButton: CGFloat = 36
    /// The composer's + and the send arrow.
    static let composerButton: CGFloat = 40
    static let sendButton: CGFloat = 32
    static let attachmentThumb: CGFloat = 64
    static let imageBubble: CGFloat = 220
    static let pinnedCard = CGSize(width: 184, height: 144)
    static let filterChip: CGFloat = 38
    static let playlistHero: CGFloat = 160
    static let finishedArt: CGFloat = 72
    static let areaSwitch: CGFloat = 150
    static let chartHeight: CGFloat = 180
    static let logo: CGFloat = 88
    static let dotSmall: CGFloat = 6
    /// Width kept free beside a message bubble.
    static let bubbleGutter: CGFloat = 56
}

/// SF Symbol sizes: beside second-line text, as row icons, in bars, and big transport icons.
enum IconSize: CGFloat {
    case meta = 15
    case row = 19
    case bar = 21
    case transport = 24
    case hero = 32
}

extension Font {
    static func icon(_ size: IconSize, weight: Font.Weight = .regular) -> Font {
        .system(size: size.rawValue, weight: weight)
    }
}

enum Radius {
    static let tag: CGFloat = 7
    static let tile: CGFloat = 8
    static let control: CGFloat = 10
    static let container: CGFloat = 14
    /// Bigger containers on the phone, to sit with iOS 26's rounder bars and sheets.
    static let card: CGFloat = 22
    /// Fields and small cards (link and file cards).
    static let field: CGFloat = 16
    /// Message bubbles.
    static let bubble: CGFloat = 20
    /// The app icon on the sign-in screen.
    static let logo: CGFloat = 20
}
