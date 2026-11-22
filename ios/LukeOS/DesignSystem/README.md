# LukeOS design system (iPhone)

Luke's greys and Geist on top of native iOS components. Screens compose these pieces; they don't set
colours, fonts, sizes or radii of their own. Change a token or component here and every screen follows.

## Tokens: `ios/Shared/Theme.swift` (shared with the widget and share extension)

| Token | What it is |
| --- | --- |
| `Grey.g0` … `Grey.g950`, `Grey.onSolid` | The web's `--grey-*` steps, light and dark, following the system appearance |
| `Color.page` | Screen background (light grey 50, dark grey 0) |
| `Color.card` | Cards and list rows, always a step lighter than the page |
| `Color.raised` | Chips and fields inside a card |
| `Color.muted`, `.selected`, `.hairline`, `.stroke`, `.strokeStrong` | Fills and edges |
| `Color.icon`, `.mutedText`, `.subtleText`, `.text`, `.ink` | Icons and text, quietest to strongest |
| `Color.notification` | Red count badges only |
| `Color.unread` | Blue 8 pt unread dots only |
| `Color.project(name)` | A project's colour (dots and chips only) |
| `Color.swipePrimary`, `.swipeSecondary` | Swipe action backgrounds |
| `LukeType` (`.tag` 13, `.meta` 14, `.preview` 15, `.control` 16 base, `.body` 16, `.heading` 18, `.section` 22, `.title` 28, `.display` 40) | The type scale (Luke, 22 Nov 2026: base 16); sizes above 16 get -4% tracking; scales with Dynamic Type |
| `Space` (`xs` 4, `s` 8, `m` 12, `l` 16, `xl` 20, `xxl` 24, `section` 32, plus `line` 6, `row` 14, `inset` 16, `page` 20) | Every gap and padding |
| `Size` (`tick` 24, `tap` 44, `chip` 26, `rowMin` 52, `artworkRow` 54, `transportMain` 76, `transportSide` 52, `fab` 60, `focusRing` 260, `focusTime` 60, `iconColumn` 28, …) | Fixed sizes of components |
| `IconSize` / `Font.icon(_:)` (`meta` 15, `row` 19, `bar` 21, `transport` 24, `hero` 32) | SF Symbol sizes; nothing smaller than 15 beside text |
| `.cardRow()`, `.taskRowInsets()` | Row padding in lists (12 or 14 above and below, 16 at the sides) |
| `Font.geist(_:medium:)`, `Font.geistMono(size:)` | Geist Regular and Medium only |
| `.textStyle(_:medium:color:)` | Applies a type step, its tracking and a colour |
| `Radius.tag` 7, `.tile` 8, `.control` 10, `.container` 14, `.field` 16, `.bubble` 20, `.card` 22 | Corner radii |

`Appearance.swift` puts Geist into the system's navigation titles, segmented controls and tab bar.

## Components

| Component | File | Used in |
| --- | --- | --- |
| `CardBox`, `CardHeader` | Components.swift | Focus sprint, scratch pad cards |
| `StatTile` (title, big value, detail line; dash when missing) | StatTile.swift | Health Today tiles |
| `StatusCircle` (empty / half / ticked) | Components.swift | Task rows, sprint, search, widget |
| `Tag` | Components.swift | Note folder, inspiration tags |
| `ClaudeMark` (faded sparkle) | Components.swift | Anything Claude made |
| `UnreadDot`, `CountBadge`, `ProjectDot` | Components.swift | More, Documents, Notes, Projects |
| `EmptyNote` | Components.swift | Every empty list |
| `SectionTitle` | Components.swift | List section headers |
| `SolidButtonStyle` (`.solid`) | Components.swift | Sign in, New sprint |
| `.pageBackground()`, `.cardRow()` | Components.swift | Every list screen |
| `PriorityChip`, `ProjectChip`, `FocusChip`, `DueLabel` | TaskChips.swift | Task rows, note and document headers |
| `ChipToggle`, `PinnedRow` | Chips.swift | Notes, Documents, Inspiration filters |
| `FlowRow` | Features/Tasks/TaskRow.swift | Task meta line, smart chips, tags |
| `MarkdownView` | MarkdownView.swift | Notes (reading), documents, comments |
| `MarkdownEditor`, `MDStyle`, `MarkdownTyping`, `MarkerFragment`, `EditorProxy`, `FormatBar` | MarkdownEditor.swift | Note editing: formatted while typing (TextKit 2), marks hidden except on the edited line, bullets and tick boxes drawn, the Markdown never rewritten |
| `NoteSegments` | NoteSegments.swift | Notes with tables: text parts edit, tables stay fixed blocks, joined back byte for byte |
| `Motion.snappy`, `.zoomSource`, `.zoomTransition`, `.rollingNumber` | Motion.swift | Springs that calm down with Reduce Motion, zoom transitions, rolling counts |
| `DelayedSpinner` | Components.swift | Loading that only shows after 0.4 s |
| `.controlRow()` | Components.swift | Switch rows at the top of lists |
| `RemoteImage`, `ImageStore` | RemoteImage.swift | Photos in notes, messages, inspiration, artwork |
| `TaskRow`, `TaskMenu`, `.taskRowActions` | Features/Tasks | Dashboard, projects, all tasks |
| `FocusRing`, `FocusControls` | Features/Focus/FocusScreen.swift | Pomodoro, Timer, Sprint |
| `Artwork`, `EpisodeRow` | Features/Music/MusicScreen.swift | Music, mini player, player |
| `MessageBubble`, `FileChip` | Features/Messages | Messages |
| `CommentThreads` | Features/Comments | Task editor, notes, documents |
| `WebScreen`, `WebSheet` | Core/WebSheet.swift | Whiteboard, Work archive, Portfolio, Agents, "Edit on the web" |

## Rules

- Glass (`.glassEffect`, `.buttonStyle(.glass)`) only on bars, sheets, menus, floating buttons and the mini player. Never on cards or rows.
- No shadows. Colour only for red badges, blue unread dots and project colours.
- Minimal copy: short empty states, no hints.
- Rows and buttons at least 44 pt tall.
