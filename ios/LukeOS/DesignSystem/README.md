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
| `LukeType` (`.tag` 12, `.meta` 13, `.preview` 14, `.control` 15, `.body` 16, `.heading` 17, `.section` 22, `.title` 26, `.display` 40) | The type scale; sizes above 16 get -4% tracking; scales with Dynamic Type |
| `Font.geist(_:medium:)`, `Font.geistMono(size:)` | Geist Regular and Medium only |
| `.textStyle(_:medium:color:)` | Applies a type step, its tracking and a colour |
| `Radius.tag` 6, `.tile` 8, `.control` 10, `.container` 14, `.card` 22 | Corner radii |

`Appearance.swift` puts Geist into the system's navigation titles, segmented controls and tab bar.

## Components

| Component | File | Used in |
| --- | --- | --- |
| `CardBox`, `CardHeader` | Components.swift | Focus sprint, scratch pad cards |
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
| `MarkdownEditor`, `MDStyle`, `EditorProxy` | MarkdownEditor.swift | Note editing |
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
