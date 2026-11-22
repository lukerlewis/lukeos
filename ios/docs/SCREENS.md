# Screens: how the phone app behaves today, and how to make it native

The pictures in `ios/docs/reference/` are captures of the phone website from the last two months. Some are older than the current code (tab order, "Effort: Small/Medium/Large" is now "Focus type: Shallow/Focus/Deep work", "Listen" is now "Music"). Where a picture and the code disagree, the code in `src/components/**` is right. Use the pictures for feel: spacing, card shapes, type sizes, how little copy there is.

The goal is not a copy of the website. Keep Luke's content, hierarchy and greys; swap the web's custom controls for the system's (Liquid Glass bars and sheets, native lists, menus, pickers, swipe actions, haptics).

## Design system on iPhone

- **Colours** (from `src/app/globals.css`, `--grey-0` to `--grey-950`, with a dark set under `.dark`): port the grey steps as a colour set that follows the system appearance. Named roles: background (0), sidebar/group fill (50), card (light 0, dark 50), muted (100), selected (200), border/dividers (200), stroke for cards and outline buttons (300), icons (600), secondary text (700), body text (800), foreground (900), titles "ink" (950). Red only for count badges, blue only for the 8 pt unread dot, project colours only for the project dot or chip.
- **Card rule:** a card is always a little lighter than what it sits on, in both modes. In dark mode the page is the darkest step and cards sit one step up. In light mode cards are white on white with a 1 pt stroke. No shadows anywhere.
- **Type:** Geist Regular and Medium only (files in `ios/Fonts/`). Web sizes: tag 12, meta 13, preview 14, control 15, body 16, heading 17, section 22, title 26, display 40; sizes above 16 have -0.04em tracking. Support Dynamic Type by scaling from these.
- **Shapes:** tags 6, buttons and fields 10, cards and containers 14. Rows and buttons at least 44 pt tall.
- **Glass:** system Liquid Glass on the tab bar, navigation bars, toolbars, sheets, menus, the floating + button and the mini player. Never on cards or list rows. Don't tint glass with colour.
- **Copy:** minimal. No intro paragraphs, no hints, short empty states ("Nothing here yet."). Sentence case.
- **Claude's things:** a small faded sparkle next to anything with `madeBy.kind == "agent"` (web: `src/components/tasks/made-by.tsx`).
- **Task circle:** empty ring (to do), half filled (doing), solid with a tick (done). Ticking plays a small pop and a light haptic; the row stays for about 0.4 s before the list updates (web: `TICK_MS` in `task-list.tsx`).
- **Motion:** subtle. System springs; honour Reduce Motion.

## Tabs

Dashboard, Notes, Focus, Music, More (web: `phoneTabs` in `src/components/shell/nav.ts`). Tab bar minimises on scroll. The Music mini player is the tab bar's bottom accessory whenever something is loaded. While a focus timer runs, the Focus tab's label shows the time left (see `focus-pomodoro.png`). Each tab remembers where Luke was (web: `place-memory.tsx`).

## Dashboard (`src/components/dashboard/*`, `src/components/tasks/*`, `src/components/board/board.tsx`)

Reference: `dashboard-work-today.png`, `dashboard-work-today-dark.png`, `dashboard-life-today-desktop.png`, `quick-add.png`, `new-task.png`, `task-editor-dark.png`, `task-comments.png`.

- Header: the date ("Thursday, October 22") and "Good morning / afternoon / evening, Luke".
- Two segmented switches: Work | Life (remembered on the device; the phone starts on Life) and Today | Board. A Filters menu: which statuses show, and Sort (several sorts in order; `src/lib/dashboard.ts`).
- Today, Life: three cards, Morning, Day, Evening, each with a count and its tasks, and an "Add to Morning" row at the bottom of each card. Today, Work: two cards, Signal then Noise, same pattern. A new task takes the card's `timeOfDay` or `lane`, the current area, and `bucket: today`.
- Task row: circle, title (one or two lines), then a quiet second line: due date if any, High/Medium/Low priority shown as 3/2/1 small flames, focus type, project chip (dot plus name), repeat icon, comment count, Claude sparkle. Done tasks are struck through and faded.
- Native gestures: swipe right to tick; swipe left for Move (Today, Tomorrow, This week, Later) and Delete; press and hold for the full menu (status, list, priority, time of day or lane, project, delete); drag between cards on Today to change time of day or lane.
- Board: the four lists as columns that page sideways (one column per page with the next one peeking), drag a card between columns to move it. Work can also group by status (To do, Doing, Done).
- Quick add: typing in an "Add to ..." row or the floating + parses dates and repeats as you type and shows them as removable chips (`src/lib/smart-entry.ts`, `src/components/tasks/smart-chips.tsx`).
- Task editor: a sheet with the title, Status (To do, Doing, Done), List (Today, Tomorrow, This week, Later), Due (date picker plus Today, Tomorrow, This weekend, Next week, No date), Repeat (never, daily, weekdays, weekly, monthly, yearly, or every N days/weeks/months/years), Priority (None, Low, Medium, High), and for Work: Focus type (None, Shallow, Focus, Deep work), Signal or Noise, Project; for Life: Morning, Day, Evening. Then Notes (Markdown with checklists) and Comments (a thread with Claude; `@claude` in a comment asks Claude). Changes save as they're made. Delete at the bottom. Opening a task does not focus the title.
- Scratch pad card under the tasks: one running Markdown note that saves as you type, with "Saved" under it.
- Delete shows an Undo toast.

## Notes (`src/app/(app)/notes/*`, `src/components/notes/*`, `src/components/pinned/pinned-row.tsx`)

Reference: `notes-list.png`, `notes-list-dark.png`.

- Main list: project chips (All plus one per project with a count, multi-select), a sideways row of pinned note cards, the folders card (name, count, chevron), then the notes that aren't in a folder (title, relative day, two-line excerpt, project dot). Search field in the navigation bar (`list_notes {search}`).
- Folder screen: its pinned row and notes, Rename/attach to a project/Delete folder in a menu.
- Row actions: Pin or Unpin, Move to folder, Set project, Delete (swipe and press-and-hold).
- Editor: title field then body. Markdown notes are edited natively: headings 1 to 3, bold, italic, strikethrough, bullet and numbered lists, checklists (tappable), quotes, links, code, dividers, photos (from the photo library or camera; upload with `save_image`, then insert `![](/api/images/<id>)`). A formatting bar above the keyboard. Autosave about 0.8 s after typing stops, showing Saving / Saved. Keep the Markdown round trip faithful: what the web editor (Tiptap, `@tiptap/markdown`) writes must read back unchanged if Luke doesn't touch it.
- A Markdown note that contains a table, or an HTML note (`format: "html"`), opens read-only natively if simple, with an "Edit on the web" button that opens `/notes/<id>` in the in-app web view. Never save a note back if the app can't represent all of it.
- Comments on a note: a thread list in a sheet (same component as tasks and documents).
- New note: the floating + makes one in the current folder or picked project.

## Focus (`src/components/focus/*`)

Reference: `focus-pomodoro.png`, `focus-sprint-picker.png`, `focus-sprint-running.png`, `focus-sprint-done.png`, `focus-stats.png`, `focus-scratch-pad.png`.

- Modes: Pomodoro, Timer (counts up), Sprint. The logic to port is in `focus-provider.tsx` (phases, rounds, what gets logged) and `sprint.tsx`.
- Pomodoro: a ring that empties, the phase name (Focus, Short break, Long break), the time, dots for rounds, and Reset, Play/Pause, Skip. Lengths come from settings (the sliders button opens them; `update_focus_settings`).
- Timer: counts up; Stop logs it.
- Sprint: pick tasks from Today and a length, then a clean running screen with the ring, the tasks to tick off, and the sprint scratch pad (`get_focus.scratchPad`, `update_scratch_pad`). Finishing shows what got done.
- Logging: every focus stretch is saved with `log_focus_session` (kind pomodoro | timer | sprint, seconds without pauses, a client-made id so it can be updated as it runs and retried safely). Breaks aren't logged.
- Brown noise toggle: loops `public/sounds/brown-noise.mp3`, keeps playing in the background, mixes with Music being paused.
- Stats: bar chart of focus time per day (7 or 30 days, `get_focus_stats`), total, and the list of sessions; a session can be edited or deleted.
- Native extras: a Live Activity for the running timer (lock screen; no Dynamic Island on the 14 Plus), a local notification when a phase ends, and the timer keeps correct time while the app is closed (store the end date, don't count ticks).

## Music (`src/components/listen/*`)

Reference: `music-list-playing-dark.png`, `music-player.png`, `music-finished.png`.

- Two tabs: Songs/Episodes and Playlists. Rows: artwork (or a headphones tile), title, show or artist, length or "12 min left", a Playing marker, and a menu (Play next, Add to playlist, Mark finished, Keep, Delete). "All songs" has Play and Shuffle, which skip songs on playlists marked left out of shuffle (`excludedFromShuffle`).
- Playlist screen: emoji or artwork, title, count and total time, Play, Shuffle, reorder by dragging, remove from playlist.
- Player: the mini player above the tab bar (artwork, title, play/pause); tapping it opens the full player sheet: artwork, title, show, scrubber with elapsed and remaining, previous, back 15 s, play/pause, forward 30 s, next, speed (0.8, 1, 1.2, 1.5, 1.75, 2), sleep-friendly close.
- The rules to port are in `listen-provider.tsx`: queue, resume at `positionSeconds`, save position every 15 s or so and on pause (`update_episode {id, positionSeconds, played: true}`), mark finished near the end (`finished: true`), move to the next in the queue.
- Native: AVPlayer with the audio background mode, Now Playing info and remote commands (lock screen, Control Center, AirPods, CarPlay buttons), interruptions (calls) and route changes (unplugging pauses). Downloads: a Download action per song and per playlist that keeps the file on the phone for no-signal listening; show what's downloaded and how much space it takes in Settings.
- Adding music is desktop only. No upload or podcast search in the app (a quiet "Add music on your computer" in the empty state is enough).
- Deleting is permanent (no Trash): confirm first.

## Messages (`src/components/messages/*`)

Reference: `messages-chain.png`, `messages-hold-menu.png`, `messages-replying.png`.

- A text conversation with Claude. Luke's bubbles on the right in black with white text (white with black text in dark mode); Claude's on the left in grey. Never blue.
- Time separators, link cards (a task, document, note, project... opens it), photos inline (tap for full screen), videos inline, files as cards (Quick Look), quoted replies above a bubble (tap to jump to the original), "Edited" label, "You unsent a message" line, and under Luke's last unanswered message: "Delivered · Claude reads it at 5am".
- Press and hold a message: Reply, Copy, and on Luke's own: Edit, Unsend.
- Composer: + (photo library, camera, files), a growing text field, send button. Send shows the bubble at once and retries quietly if offline.
- Opening the chain marks Claude's messages read and clears the badge.
- A banner to turn on notifications until Luke has answered the system prompt.

## More (`src/app/(app)/projects/page.tsx` on phones)

Reference: `more-tab.png` (older; the list is longer now).

Native rows: Messages (with unread badge), Search, All tasks, Documents (with a New count), Inspiration, Trash, Settings. Then Projects (colour dot, name, open task count) and New project. Then "On the web": Whiteboard, Work archive, Portfolio, Agents: each opens the site's page in an in-app web view signed in with the token cookie.

- **Search** (`src/core/search.ts`): one field, results grouped by kind (tasks, notes, documents, projects, inspiration), tapping opens the thing.
- **All tasks** (`src/app/(app)/tasks/page.tsx`): every task with filters for area, project, status and list.
- **Project** (`src/app/(app)/projects/[id]`): List, Board, Notes, Links tabs (and Inspiration). Links: title, site, note, pinned row (`project-links.png`). The Board's Pipeline opens on the web.
- **Documents** (`src/components/documents/*`): list with Made by me / Claude filter, pinned row, blue dot on new ones. Opening one shows the page rendered from Markdown (headings, lists, checklists, tables, photos, quotes), read-only natively, with Comments, Share as PDF (`GET /api/documents/<id>/pdf`), and "Edit on the web". Opening marks Claude's new documents as seen (`mark_from_claude_seen`).
- **Inspiration** (`src/components/inspiration/*`, `inspiration.png`): a two-column masonry of pictures, links, quotes and files, tag and project filters, search. Opening one shows it large with title, note, tags, source link. Add from the photo library, a pasted link or typed text.
- **Trash** (`src/core/trash.ts`): everything deleted in the last 30 days by kind, Restore, Delete forever, Empty Trash.
- **Settings**: notifications on/off and Send a test, Face ID lock, downloads and storage used, time zone, appearance follows the system, Open settings on the web (devices, Claude connector), Sign out, app version.

## iPhone extras

- **Widget**: Today's tasks for the area last shown (small: count and next task; medium and large: a list with tick buttons using App Intents). Reads the shared cache in the App Group; refreshes when the app syncs.
- **Share extension** "Save to LukeOS": a link, text or picture from any app goes to Inspiration (`add_inspiration` or `/api/inspiration/upload`), with an optional note and project. This replaces the Shortcut.
- **App Intents / Siri / Shortcuts**: "Add a task to LukeOS" (title, optional list), "Start a focus timer", "Open Messages".
- **Deep links** from notifications and widgets: `lukeos://task/<id>`, `lukeos://messages`, `lukeos://note/<id>`, `lukeos://document/<id>`.
