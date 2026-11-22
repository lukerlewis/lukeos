# LukeOS API for the iPhone app

Everything the app does goes through the same back end as the website. Base address: `https://lukeos-kappa.vercel.app` (a local server for testing: `http://localhost:3111`).

Real responses for every read are in `ios/Fixtures/` (captured from a seeded local server on 2026-11-21, Luke's time zone America/New_York). `Fixtures/index.json` lists each file with the operation and input that produced it. `Fixtures/files.json` maps each `/api/stored/<id>` and `/api/images/<id>` address used in the fixtures to a real file in `Fixtures/files/`, so demo mode can show pictures and play audio. Podcast episodes in the fixtures point at `https://example.com/...` (not real audio); in demo mode play a bundled file for them.

## Signing in

1. Luke opens Settings on a signed-in device (the website, or the Home Screen web app on the same phone), and under "Devices that can sign in" taps "Add a new device". It shows a link (`https://lukeos-kappa.vercel.app/sign-in/add/ABCDE-23456`) with a Copy link button, and the 10 character code on its own (`ABCDE-23456`, valid 10 minutes, works once). The app's sign-in field should take either the typed code or the pasted link (pull the code off the end), with a Paste button.
2. The app sends `POST /api/auth/invite/use` with header `x-lukeos-client: ios` and body `{"code":"ABCDE-23456"}` (case and dashes don't matter).
   - 200: `{"ok":true,"token":"bucj1p_aem2FUy4EOQwV4Ol769aS7U1jsGEgJKAjb8A"}`
   - 403: `{"error":"That code didn't work. Make a new one in Settings."}`
3. Keep the token in the Keychain (shared with the widget and share extensions). Send it on every request as `Authorization: Bearer <token>`.
4. The same token is also accepted as the cookie `lukeos_session=<token>`. Web pages (`/whiteboard`, `/portfolio`, ...) only accept the cookie, so set it in the web view's cookie store for `lukeos-kappa.vercel.app` (HttpOnly, Secure, path `/`).
5. Any 401 `{"error":"Not signed in."}` means the token is no longer valid: forget it and show sign-in.
6. `POST /api/auth/logout` ends the session on the server.

The session lasts 180 days and is pushed back out each time the app uses it, so Luke stays signed in.

## Operations

Every action is `POST /api/ops/<name>` with a JSON body (send `{}` when there's no input).

- 200: the result as JSON (shapes below and in the fixtures).
- 400 / 404 / 403 / 507: `{"error":"A sentence that can be shown to Luke as it is."}`
- 401: not signed in.
- `null` in an input clears a field; a field left out is unchanged.
- `routine` inputs are for Claude only. Never send them.

Conventions in results:

- Moments are ISO strings with milliseconds in UTC: `"2026-11-22T02:10:31.753Z"`.
- Due dates and "today" are plain days: `"2026-11-21"`, in Luke's time zone.
- `madeBy`: `{ "kind": "user" | "agent", "name": string | null, "routine": string | null }`. `kind: "agent"` means Claude made it: show the small faded sparkle.
- `project` on tasks, notes and documents: `{ id, name, color, hex } | null`. `hex` is the dot colour.
- Ids are UUIDs. The app may pick its own id for a new focus session (`log_focus_session.id`), which makes retries safe.

### Things the app has to work out itself (as the website does)

- **Dashboard.** One `list_tasks` with `{}` gives every open task in both areas (up to 500). Add `list_tasks {"status":"done","limit":200}` and keep only those whose `completedAt` falls today in Luke's time zone, if Done is switched on in the view. Then filter by `area` (work | life) on the device; the phone starts on Life and remembers the switch. Today tab = tasks with `bucket == "today"`; Board = four columns by `bucket` (today, tomorrow, this_week, later). Life's Today is three cards by `timeOfDay` (morning, day, evening). Work's Today is two cards by `lane` (signal on top, then noise). Which statuses show and the sort come from `dashboardView` (`/api/app/home`), shared across devices; change them with `set_dashboard_view`. Sorting rules are in `src/lib/board.ts` (`sortTasks`, `compareTasks`): Doing, then To do, then Done; then each chosen sort in turn; then soonest due, highest priority, oldest.
- **Ticking a task.** Tap the circle: `update_task {id, status: "done"}`; tap again: `"todo"`. Doing is only set from the editor or the status board. A repeating task's next copy is made by the server when it's marked done, so refresh the list after.
- **Lists are not due dates.** Moving between Today / Tomorrow / This week / Later sets `bucket` only (`move_task {id, to}` or `update_task {bucket}`), never the date. A new task with a date and no bucket is filed by the server.
- **Smart entry.** Typing "Call mum tomorrow every week" pulls out a date and a repeat. The rules are in `src/lib/smart-entry.ts`; port them. "this week" and "later" set the list only.
- **Dates shown.** `friendlyDay` in `src/lib/dates.ts`: Today, Tomorrow, Yesterday, a weekday for the next 6 days, "Thu 8 Oct" this year, "8 Oct 2027" otherwise. Late dates are medium weight ink, not red.
- **Notes list.** `list_notes {}` returns every note (pinned first). The main list shows: project chips, the pinned row (cards, scroll sideways), folders (`list_folders`), then notes that aren't in a folder. A folder shows its own pinned row and notes (`list_notes {folderId}`).
- **New note.** `create_note {title:"", content:"", folderId?, projectId?}` then open it; if it's left with no title and no text, `delete_note` it. Saving: `update_note {id, title?, content}` about 0.8 s after typing stops.
- **Scratch pad** (bottom of the dashboard): it's a note. Its id and text come from `/api/app/home`; save with `update_note {id, content}`.
- **Unread dot / badges.** `unreadMessages` from `/api/app/home`. Opening Messages calls `mark_messages_read`.

### Choosing ids in the app (offline creates)

`create_task` and `create_note` take an optional `id` (a UUID the app makes up). Always send one: the task or note then has its real id from the first moment, so edits queued while offline still point at it, and sending the same create twice (a retry after a dropped connection) returns the existing one instead of adding a second. `log_focus_session` works the same way and also updates the time when the id exists.

## App-only reads

These aren't operations (so they don't appear as Claude tools). Same sign-in.

### `GET /api/app/home`

What the app needs as it opens. Real response: `Fixtures/app_home.json`.

```
{ today, timeZone, unreadMessages, newFromClaude,
  scratchPad: { id, content, updatedAt },
  dashboardView: { layout: "list" | "board", show: Status[], sort: [{ by, dir }] },
  focus: { settings: { focusMinutes, shortBreakMinutes, longBreakMinutes, roundsBeforeLongBreak }, scratchPad },
  nextCheckIn: ISO | null }
```

If the phone's time zone differs from `timeZone`, call `set_time_zone {"timeZone":"America/New_York"}` (the website does this on every load).

### `GET /api/app/messages?limit=200`

The Messages chain as the app shows it, oldest first. Real response: `Fixtures/app_messages.json`.

```
{ messages: Message[], unread: number, nextCheckIn: ISO | null }
```

Like `list_messages`, but an unsent message stays in the list as `{ unsent: true, text: "", attachments: [] }` so the app can show the quiet line "You unsent a message" (or "Claude unsent a message") in its place. Under Luke's last message, when it isn't answered yet, show "Delivered · Claude reads it at 5am" using `nextCheckIn`.

## Files

- `GET /api/stored/<id>`: audio uploads, message attachments, inspiration pictures. Answers `Range` requests (needed for audio and video). Add `?name=<file name>` to get a download with that name.
- `GET /api/images/<id>`: photos inside notes and documents. In Markdown they appear as `![alt](/api/images/<id>)`, sometimes with `#width=50` on the end (show at 50% of the text width).
- Both need the token (header or cookie) and never change, so cache them forever.
- Message pictures are WebP with a small `thumb` copy; use `thumb` in the chain and `url` full screen.

## Uploads

All take the raw file as the request body (not multipart), `content-type` set to the file's type, and the name percent-encoded in `x-file-name`.

- `POST /api/messages/upload` (up to 4 MB): returns `{ fileId, thumbId?, kind: "image" | "video" | "file", name, mimeType, bytes, width?, height? }`. Then send the message with `send_message {text, attachments: [{ fileId, thumbId, name, width, height }], replyTo?}`. Shrink photos on the phone first (longest side 2000 px, JPEG). Bigger files (videos) go through Vercel Blob on the website; leave that out of the app for now and tell Luke a file over 4 MB can't be sent from the phone yet.
- `POST /api/inspiration/upload` (up to 4 MB), optional header `x-project-id`: saves a picture or file to Inspiration and returns the new item (same shape as `get_inspiration`). Links and text use the operation instead: `add_inspiration {url}` or `add_inspiration {text, source?}`.
- `save_image` (operation): `{ data: base64, mimeType }` up to 3 MB, returns `{ id, url, markdown }` for a photo in a note.
- Music uploads are desktop only. Don't add them to the app.

## Notifications

- After Luke allows notifications: `POST /api/push/apns` `{"deviceToken":"<hex>","deviceName":"iPhone 14 Plus","environment":"sandbox"}`. Use `"sandbox"` for a build put on the phone from Xcode and `"production"` for TestFlight. Call it on every launch (the token can change); it's safe to repeat.
- Turning them off: `DELETE /api/push/apns` `{"deviceToken":"<hex>"}`.
- `POST /api/push/test` sends a test to every device and returns `{ reached }`.
- A notification looks like:

```
{ "aps": { "alert": { "title": "Claude", "body": "The blurb is in Documents." }, "sound": "default", "badge": 3, "thread-id": "lukeos-messages" },
  "url": "/messages" }
```

  `url` is where to open on tap: `/messages`, `/?task=<id>` (a task, over the dashboard), `/documents/<id>`, `/notes/<id>`, `/archive/<id>`, `/cards/<id>`, `/whiteboard/<id>?comments=1`. Open the last three in the web view.
- Sending needs an Apple key that Luke adds once on the website (Settings > iPhone app notifications). Until then nothing arrives, with no error.

## Operation reference

Inputs are written as `{ name: type, optional?: type }`. Descriptions are shortened; the full wording and rules are in `src/core/<area>.ts`.

## Start-up and settings

### `get_app_info`

Basic facts about this LukeOS install: today's date and time zone, and how many devices can sign in.

- Input: `{  }`
- Real responses: `Fixtures/get_app_info.json`

### `set_time_zone`

Set Luke's time zone (an IANA name such as Europe/London), which decides what counts as today.

- Input: `{ timeZone: string }`


## Tasks and dashboard

### `list_tasks`

List tasks, soonest due first.

- Input: `{ projectId?: string (uuid) | null, area?: "work" | "life", status?: "todo" | "doing" | "done", bucket?: "today" | "tomorrow" | "this_week" | "later", includeDone?: boolean, dueOnOrAfter?: string, dueOnOrBefore?: string, limit?: integer }`
- Real responses: `Fixtures/list_tasks.json`, `Fixtures/list_tasks.done.json` (input `{"status": "done", "limit": 200}`), `Fixtures/list_tasks.project.json` (input `{"projectId": "12ac250b-2a67-434d-a1c3-73eaca86549a", "includeDone": true}`)

### `get_task`

Get one task with all its fields, including notes.

- Input: `{ id: string (uuid) }`
- Real responses: `Fixtures/get_task.json` (input `{"id": "7ffc6a13-a2cd-4d97-b954-1ad110ff931f"}`), `Fixtures/get_task.life.json` (input `{"id": "3f7e3471-6acc-4898-a6e9-a0530a3040b7"}`)

### `create_task`

Create a task.

- Input: `{ title: string, projectId?: string (uuid) | null, cardId?: string (uuid) | null, status?: "todo" | "doing" | "done", bucket?: "today" | "tomorrow" | "this_week" | "later", dueDate?: string | null, priority?: "low" | "medium" | "high" | null, effort?: "shallow" | "focus" | "deep" | null, area?: "work" | "life", timeOfDay?: "morning" | "day" | "evening", lane?: "signal" | "noise", notes?: string | null, repeat?: string | null }`

### `update_task`

Change any fields of a task: title, project, card, status, list (bucket), due date, priority, focus type (effort), area (work or life), time of day (Life's morning, day or evening), lane (Work's signal or noise), notes or how it repeats.

- Input: `{ id: string (uuid), title?: string, projectId?: string (uuid) | null, cardId?: string (uuid) | null, status?: "todo" | "doing" | "done", bucket?: "today" | "tomorrow" | "this_week" | "later", dueDate?: string | null, priority?: "low" | "medium" | "high" | null, effort?: "shallow" | "focus" | "deep" | null, area?: "work" | "life", timeOfDay?: "morning" | "day" | "evening", lane?: "signal" | "noise", notes?: string | null, repeat?: string | null }`

### `delete_task`

Move a task to Trash, where it's kept for 30 days.

- Input: `{ id: string (uuid) }`

### `move_task`

Move a task to a board column, just like dragging its card.

- Input: `{ id: string (uuid), to: "today" | "tomorrow" | "this_week" | "later" | "todo" | "doing" | "done" }`

### `update_tasks`

Change several tasks at once: their project, list (bucket), status, due date, priority, focus type (effort), area (work or life), time of day (Life's morning, day or evening) or lane (Work's signal or noise).

- Input: `{ ids: [string (uuid)], projectId?: string (uuid) | null, status?: "todo" | "doing" | "done", bucket?: "today" | "tomorrow" | "this_week" | "later", dueDate?: string | null, priority?: "low" | "medium" | "high" | null, effort?: "shallow" | "focus" | "deep" | null, area?: "work" | "life", timeOfDay?: "morning" | "day" | "evening", lane?: "signal" | "noise" }`

### `move_tasks`

Move several tasks to a board column at once, just like move_task does for one.

- Input: `{ ids: [string (uuid)], to: "today" | "tomorrow" | "this_week" | "later" | "todo" | "doing" | "done" }`

### `delete_tasks`

Move several tasks to Trash at once.

- Input: `{ ids: [string (uuid)] }`

### `get_today`

What's on Luke's plate: today's date in his time zone, the open tasks in his Today list (todayList), and open tasks that are overdue, due today, or due in the next 7 days, whatever list they're in.

- Input: `{  }`
- Real responses: `Fixtures/get_today.json`

### `get_board`

Luke's task board, column by column.

- Input: `{ view?: "when" | "status", projectId?: string (uuid), show?: ["todo" | "doing" | "done"] }`
- Real responses: `Fixtures/get_board.json`

### `get_dashboard`

Luke's dashboard (the app's home screen) as he has it set up.

- Input: `{ by?: "when" | "status", show?: ["todo" | "doing" | "done"] }`
- Real responses: `Fixtures/get_dashboard.json`

### `set_dashboard_view`

Change how Luke's dashboard looks, just like the switches at the top of it: the Today tab or the Board, which statuses show, and how tasks are sorted (in the Today list and in each Board column).

- Input: `{ layout?: "list" | "board", show?: ["todo" | "doing" | "done"], sort?: [{ by: "priority" | "effort" | "project" | "name" | "created", dir: "desc" | "asc" }] | { by: "priority" | "effort" | "project" | "name" | "created", dir: "desc" | "asc" } }`


## Projects and links

### `list_projects`

List Luke's projects (not ones in Trash) with how many open and done tasks each has.

- Input: `{  }`
- Real responses: `Fixtures/list_projects.json`

### `get_project`

Get one project with all of its tasks (including done ones), its pipeline (get_pipeline shows its cards), its documents, the note folders attached to it and its notes (including those in its folders): titles and excerpts; use get_document or get_note for the full text.

- Input: `{ id: string (uuid) }`
- Real responses: `Fixtures/get_project.json` (input `{"id": "12ac250b-2a67-434d-a1c3-73eaca86549a"}`)

### `create_project`

Create a project (in Work).

- Input: `{ name: string, color?: "orange" | "blue" | "violet" | "teal" | "pink" | "green" | "amber" | "slate", area?: "work" }`

### `update_project`

Rename a project or change its colour.

- Input: `{ id: string (uuid), name?: string, color?: "orange" | "blue" | "violet" | "teal" | "pink" | "green" | "amber" | "slate", area?: "work" }`

### `delete_project`

Move a project and all of its tasks, notes, documents and pipeline cards to Trash, where they are kept for 30 days.

- Input: `{ id: string (uuid) }`

### `list_links`

List the links saved on a project's Links tab (web address, title, note, pinned), pinned ones first, then newest first.

- Input: `{ projectId: string (uuid) }`
- Real responses: `Fixtures/list_links.json` (input `{"projectId": "12ac250b-2a67-434d-a1c3-73eaca86549a"}`)

### `add_link`

Save a web link on a project's Links tab, for pages Luke keeps coming back to for that project (a Figma file, a doc, a site).

- Input: `{ projectId: string (uuid), url: string, title?: string | null, note?: string | null, pinned?: boolean }`

### `update_link`

Change a saved link's web address, title or note, or pin or unpin it.

- Input: `{ id: string (uuid), url?: string, title?: string | null, note?: string | null, pinned?: boolean }`

### `delete_link`

Remove a saved link from its project.

- Input: `{ id: string (uuid) }`


## Notes and folders

### `list_notes`

List notes: pinned ones first, then the most recently changed, with a short excerpt of each (use get_note for the full text).

- Input: `{ projectId?: string (uuid) | null, folderId?: string (uuid) | null, madeBy?: "luke" | "claude", search?: string, limit?: integer }`
- Real responses: `Fixtures/list_notes.json`, `Fixtures/list_notes.folder.json` (input `{"folderId": "e4a1f67a-467f-42be-af41-db50ad35c42e"}`), `Fixtures/list_notes.search.json` (input `{"search": "glass"}`)

### `get_note`

Get one note with its full text (Markdown, or HTML for a saved page).

- Input: `{ id: string (uuid) }`
- Real responses: `Fixtures/get_note.json` (input `{"id": "a1f44d5d-8de9-4b1f-8446-cbcd463bf195"}`), `Fixtures/get_note.table.json` (input `{"id": "0392ec81-44da-4d8c-9d2c-c80be6bf75b0"}`), `Fixtures/get_note.html.json` (input `{"id": "1d68c31b-8881-4c8b-a4e6-c29b8d5b4b4f"}`), `Fixtures/get_note.checklist.json` (input `{"id": "07873f1c-a1a7-41f3-a77e-f4f8297ba067"}`)

### `create_note`

Create a note in Luke's Notes, on its own or inside a project, written in Markdown.

- Input: `{ title?: string, content?: string, format?: "markdown" | "html", projectId?: string (uuid) | null, folderId?: string (uuid) | null }`

### `update_note`

Change one of Luke's notes: its title, its whole text, its project, its folder, or whether it's pinned to the top of his notes.

- Input: `{ id: string (uuid), title?: string, content?: string, append?: string, projectId?: string (uuid) | null, folderId?: string (uuid) | null, pinned?: boolean }`

### `delete_note`

Move a note to Trash, where it's kept for 30 days.

- Input: `{ id: string (uuid) }`

### `update_notes`

Change several notes at once: move them into a project or out of their project (projectId null), into a folder or out of their folder (folderId null), or pin or unpin them.

- Input: `{ ids: [string (uuid)], projectId?: string (uuid) | null, folderId?: string (uuid) | null, pinned?: boolean }`

### `delete_notes`

Move several notes to Trash at once.

- Input: `{ ids: [string (uuid)] }`

### `save_image`

Save a photo (JPEG, PNG, WebP or GIF, up to 3 MB) so it can go in a document or a note.

- Input: `{ data: string (base64), mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif", alt?: string }`

### `list_folders`

List the folders in Luke's Notes, with the project each is attached to and how many notes are in it.

- Input: `{ projectId?: string (uuid) }`
- Real responses: `Fixtures/list_folders.json`

### `create_folder`

Make a folder in Luke's Notes, optionally attached to a project.

- Input: `{ name: string, projectId?: string (uuid) | null }`

### `update_folder`

Rename a folder, or attach it to a project or detach it (projectId null).

- Input: `{ id: string (uuid), name?: string, projectId?: string (uuid) | null }`

### `delete_folder`

Delete a folder.

- Input: `{ id: string (uuid) }`


## Documents

### `list_documents`

List Luke's documents (printable pages, by Luke or Claude): pinned ones first, then the most recently changed, with a short excerpt of each and how many unresolved comments it has.

- Input: `{ projectId?: string (uuid) | null, madeBy?: "luke" | "claude", search?: string, limit?: integer }`
- Real responses: `Fixtures/list_documents.json`

### `get_document`

Get one document with its full text (Markdown).

- Input: `{ id: string (uuid) }`
- Real responses: `Fixtures/get_document.json` (input `{"id": "93e1e741-f28f-4cf3-840e-362a0c87314b"}`)

### `create_document`

Save something you wrote for Luke as a document: a report, research, a plan, a summary, a case study, a letter, anything to read, share or print.

- Input: `{ title: string, content?: string, projectId?: string (uuid) | null }`

### `update_document`

Change a document: its title, its whole text, its project, or whether it's pinned above Luke's documents.

- Input: `{ id: string (uuid), title?: string, content?: string, append?: string, projectId?: string (uuid) | null, pinned?: boolean }`

### `delete_document`

Move a document to Trash, where it's kept for 30 days.

- Input: `{ id: string (uuid) }`

### `list_from_claude`

What Claude has made in LukeOS (documents, tasks and projects), newest first.

- Input: `{ type?: "document" | "task" | "project", limit?: integer }`
- Real responses: `Fixtures/list_from_claude.json`

### `mark_from_claude_seen`

Clear the New markers on Claude's documents, as if Luke had looked at his Documents.

- Input: `{  }`


## Comments and @claude requests

### `list_comments`

Comment threads on Luke's documents, notes, tasks, Work archive entries, pipeline cards, whiteboards and artifacts, each with its replies.

- Input: `{ targetType?: "note" | "artifact" | "document" | "task" | "entry" | "card" | "whiteboard", targetId?: string (uuid), open?: boolean, limit?: integer }`
- Real responses: `Fixtures/list_comments.task.json` (input `{"targetType": "task", "targetId": "7ffc6a13-a2cd-4d97-b954-1ad110ff931f"}`), `Fixtures/list_comments.document.json` (input `{"targetType": "document", "targetId": "93e1e741-f28f-4cf3-840e-362a0c87314b"}`), `Fixtures/list_comments.note.json` (input `{"targetType": "note", "targetId": "715ab7af-c108-4828-b05c-74e6013a735c"}`), `Fixtures/list_comments.open.json` (input `{"open": true}`)

### `add_comment`

Start a comment thread on a document, a note, a task, a Work archive entry, a pipeline card, a whiteboard or an artifact.

- Input: `{ targetType: "note" | "artifact" | "document" | "task" | "entry" | "card" | "whiteboard", targetId: string (uuid), body: string, quote?: string, pin?: { item?: string, x?: number, y?: number } }`

### `reply_to_comment`

Answer a comment thread, e.g.

- Input: `{ id: string (uuid), body: string }`

### `resolve_comment`

Mark a comment thread as dealt with (or open it again with resolved: false).

- Input: `{ id: string (uuid), resolved?: boolean }`

### `delete_comment`

Delete a comment (and, for the first comment in a thread, its replies).

- Input: `{ id: string (uuid) }`

### `list_mentions`

Luke's @claude requests: every place he wrote "@claude" (in a note, a task, a comment, or the scratch pad on his dashboard), newest first.

- Input: `{ open?: boolean, limit?: integer }`
- Real responses: `Fixtures/list_mentions.json`


## Messages

### `list_messages`

The Messages chain between Luke and Claude, oldest first (the newest at the end), like a text conversation.

- Input: `{ waiting?: boolean, limit?: integer }`
- Real responses: `Fixtures/list_messages.json`

### `send_message`

Text Luke in his Messages chain.

- Input: `{ text?: string, link?: { type: "task" | "note" | "document" | "artifact" | "project" | "routine" | "entry" | "inspiration", id: string (uuid) }, answers?: [string (uuid)], replyTo?: string (uuid), attachments?: [{ name: string, mimeType: string, data: string (base64) } | { fileId: string (uuid), thumbId?: string (uuid) | null, name?: string, width?: integer | null, height?: integer | null }] }`

### `edit_message`

Change the text of a message you sent Luke, e.g.

- Input: `{ id: string (uuid), text: string }`

### `unsend_message`

Unsend a message you sent Luke: it disappears from the chain (a quiet "unsent" line stays in its place) along with its photos and files, and waits in Trash for 30 days.

- Input: `{ id: string (uuid) }`

### `mark_messages_read`

Marks Claude's messages as seen.

- Input: `{  }`


## Focus

### `get_focus`

Luke's Focus section: his pomodoro lengths (focus, short break, long break, in minutes, and rounds before a long break), and his sprint scratch pad (things he jotted down mid-sprint so they don't distract him).

- Input: `{  }`
- Real responses: `Fixtures/get_focus.json`

### `update_scratch_pad`

Replace the text of Luke's sprint scratch pad (shown under a focus sprint's tasks; get_focus has the current text).

- Input: `{ text: string }`

### `update_focus_settings`

Change Luke's pomodoro lengths, in minutes: focus, short break, long break, and how many focus rounds come before a long break.

- Input: `{ focusMinutes?: integer, shortBreakMinutes?: integer, longBreakMinutes?: integer, roundsBeforeLongBreak?: integer }`

### `get_focus_stats`

How long Luke focused each day (pomodoro focus rounds, the regular timer and focus sprints, whose label lists the tasks he picked for it; breaks and brown noise on its own don't count), for the last N days in his time zone, oldest first, plus each logged session with its id (sessions count towards the day they ended).

- Input: `{ days?: integer }`
- Real responses: `Fixtures/get_focus_stats.json` (input `{"days": 7}`), `Fixtures/get_focus_stats.30.json` (input `{"days": 30}`)

### `log_focus_session`

Record time Luke spent focusing.

- Input: `{ id?: string (uuid), kind?: "pomodoro" | "timer" | "sprint", seconds: integer, endedAt?: string (date-time), startedAt?: string (date-time), label?: string }`

### `update_focus_session`

Fix a logged focus session (ids come from get_focus_stats): how long Luke focused, when it started or ended, what it was for.

- Input: `{ id: string (uuid), seconds?: integer, startedAt?: string (date-time), endedAt?: string (date-time), label?: string | null, kind?: "pomodoro" | "timer" | "sprint" }`

### `delete_focus_session`

Delete a logged focus session for good (ids come from get_focus_stats).

- Input: `{ id: string (uuid) }`


## Music

### `list_episodes`

Luke's Listen library: MP3s he uploaded and podcast episodes he picked, newest added first, with how far he got (positionSeconds) and whether he's finished each.

- Input: `{ status?: "unfinished" | "finished" | "all" }`
- Real responses: `Fixtures/list_episodes.json`

### `update_episode`

Change an episode in Listen: its title or show/artist, where Luke is in it (positionSeconds), whether it's finished, or kept (Luke chose to keep it after finishing).

- Input: `{ id: string (uuid), title?: string, show?: string | null, positionSeconds?: number, durationSeconds?: number, finished?: boolean, kept?: boolean, played?: boolean }`

### `delete_episode`

Delete an episode or song from Listen for good.

- Input: `{ id: string (uuid) }`

### `list_playlists`

Luke's Listen playlists, with how many episodes or songs each holds, their total length in seconds, and whether each is left out of All songs' Shuffle (excludedFromShuffle).

- Input: `{  }`
- Real responses: `Fixtures/list_playlists.json`

### `get_playlist`

One Listen playlist with its episodes and songs in order.

- Input: `{ id: string (uuid) }`
- Real responses: `Fixtures/get_playlist.json` (input `{"id": "86940421-621c-4320-bc8b-f9ed637a1f07"}`), `Fixtures/get_playlist.focus.json` (input `{"id": "c8aa4fac-7767-4ee2-95eb-c706d4df3c5a"}`), `Fixtures/get_playlist.empty.json` (input `{"id": "49350c1c-6bbc-4edd-9385-fb09582632dd"}`)

### `create_playlist`

Make a Listen playlist, optionally with episodes in it (ids from list_episodes) in that order.

- Input: `{ title: string, icon?: string | null, episodeIds?: [string (uuid)] }`

### `update_playlist`

Rename a Listen playlist, change its emoji, set its whole order with episodeIds (anything left out is taken off the playlist, not deleted), or leave it out of All songs' Play and Shuffle (excludeFromShuffle: its songs don't come up when Luke plays or shuffles all songs).

- Input: `{ id: string (uuid), title?: string, icon?: string | null, episodeIds?: [string (uuid)], excludeFromShuffle?: boolean }`

### `add_to_playlist`

Put episodes or songs at the end of a Listen playlist (ones already on it stay where they are).

- Input: `{ playlistId: string (uuid), episodeIds: [string (uuid)] }`

### `remove_from_playlist`

Take episodes or songs off a Listen playlist.

- Input: `{ playlistId: string (uuid), episodeIds: [string (uuid)] }`

### `delete_playlist`

Delete a Listen playlist for good.

- Input: `{ id: string (uuid) }`

### `search_podcasts`

Find podcasts by name or topic in Apple's podcast directory.

- Input: `{ query: string }`

### `get_podcast`

A podcast's episodes, newest first, from its feed (feedUrl from search_podcasts) or a pasted link (an Apple Podcasts show or episode link, or an RSS feed).

- Input: `{ feedUrl?: string, url?: string, query?: string, limit?: integer }`

### `add_episode`

Add one podcast episode to Luke's Listen library.

- Input: `{ feedUrl?: string, guid?: string, url?: string, playlistId?: string (uuid) }`


## Inspiration

### `list_inspiration`

List Luke's Inspiration: his gallery of things that inspire him (pictures, links, videos, quotes, PDFs), newest first, with tags and your descriptions.

- Input: `{ search?: string, tag?: string, kind?: "image" | "link" | "video" | "text" | "file", projectId?: string (uuid), untagged?: boolean, limit?: integer }`
- Real responses: `Fixtures/list_inspiration.json`

### `list_inspiration_tags`

The tags used in Inspiration, most used first, so new tags match the ones Luke already has.

- Input: `{  }`
- Real responses: `Fixtures/list_inspiration_tags.json`

### `get_inspiration`

Get one Inspiration item with all its details.

- Input: `{ id: string (uuid), look?: boolean }`
- Real responses: `Fixtures/get_inspiration.json` (input `{"id": "fa3d0929-d7aa-42a6-9660-4ab77e9dec5a"}`), `Fixtures/get_inspiration.quote.json` (input `{"id": "3941efdb-82c0-4467-9639-da8b6ee1822f"}`)

### `add_inspiration`

Save something to Luke's Inspiration.

- Input: `{ url?: string, text?: string, image?: { data: string (base64), mimeType: string }, source?: string, title?: string, note?: string, tags?: [string], summary?: string | null, projectId?: string (uuid) | null }`

### `update_inspiration`

Change an Inspiration item: tags, your description (summary), title, project, where it came from, a quote's text, or Luke's note (only when he asks).

- Input: `{ id: string (uuid), title?: string, note?: string, body?: string, summary?: string | null, tags?: [string], addTags?: [string], removeTags?: [string], projectId?: string (uuid) | null, url?: string | null }`

### `delete_inspiration`

Move an Inspiration item to Trash, where it's kept for 30 days.

- Input: `{ id: string (uuid) }`


## Search, activity and Trash

### `search`

Search everything in LukeOS (not Trash): task titles and task notes, document titles and text, pipeline cards (title and notes), note titles and text, Work archive entries (title, story and details), Inspiration (titles, text, tags and descriptions), and project names.

- Input: `{ query: string, type?: "task" | "document" | "card" | "note" | "project" | "entry" | "inspiration", limit?: integer }`
- Real responses: `Fixtures/search.json` (input `{"query": "glass"}`)

### `list_activity`

The activity log: a short line for each change Claude has made in LukeOS through this connector (adding, editing, moving, deleting), with the time, newest first.

- Input: `{ limit?: integer }`
- Real responses: `Fixtures/list_activity.json` (input `{"limit": 30}`)

### `list_trash`

What's in Trash, most recently deleted first.

- Input: `{ type?: "task" | "note" | "artifact" | "document" | "card" | "project" | "skill" | "context" | "routine" | "entry" | "inspiration" | "message" | "whiteboard" }`
- Real responses: `Fixtures/list_trash.json`

### `restore_from_trash`

Bring a task, note, document, pipeline card, artifact, project, skill, context file, routine, Work archive entry, Inspiration item, whiteboard or unsent message back from Trash (a message goes back where it was in the chain).

- Input: `{ type: "task" | "note" | "artifact" | "document" | "card" | "project" | "skill" | "context" | "routine" | "entry" | "inspiration" | "message" | "whiteboard", id: string (uuid) }`

### `delete_forever`

Permanently delete something that's already in Trash.

- Input: `{ type: "task" | "note" | "artifact" | "document" | "card" | "project" | "skill" | "context" | "routine" | "entry" | "inspiration" | "message" | "whiteboard", id: string (uuid) }`

### `empty_trash`

Permanently delete everything in Trash.

- Input: `{  }`

## Health

Data from Luke's Fitbit (Fitbit Air) through the Google Health API, synced on the server (`src/core/health.ts`, `src/core/health-google.ts`). Every number may be null; the app reads numbers as decimals and ignores fields it doesn't know.

### `get_health`

Daily health numbers for the last `days` days (1 to 90, default 30), oldest first, today last, with whether Fitbit is connected.

- Input: `{ days?: integer }`
- Output: `{ configured: boolean, connected: boolean, lastSyncAt: string | null, today: "YYYY-MM-DD", timeZone: string, days: [{ date, steps, distanceMeters, activeMinutes, caloriesOut, restingHeartRate, hrvMs, breathingRate, spo2, skinTempDeviation, vo2Max, sleep: { minutes, start, end, deepMinutes, lightMinutes, remMinutes, awakeMinutes } | null, workouts: [{ type, name, minutes, startedAt, calories, distanceMeters }] }] }`
- The status also has `connectedAt`, `lastError`, `failedTypes`, `liveUpdates` and `liveUpdatesError`, which the app doesn't use.
- When connected, every day in the range is present, all null with `workouts: []` on days with nothing.
- A night's sleep counts towards the day Luke woke up.
- `today` and `timeZone` are Luke's.
- `skinTempDeviation` is in °C against his baseline.
- `workouts[].type` is Google's enum (RUNNING, STRENGTH_TRAINING, OUTDOOR_BIKE, HIIT…). `name` is the custom name from the Fitbit app, or null.
- Demo responses: `Fixtures/get_health.json` (input `{"days": 30}`), `Fixtures/get_health.notconfigured.json` (demo input `{"demoState": "notconfigured"}`), `Fixtures/get_health.gaps.json` (demo input `{"demoState": "gaps"}`)

### `sync_health`

Pull the latest from Fitbit now. Slow, because the server talks to Google, so the app gives it 120 s and never queues it offline.

- Input: `{ days?: integer }` (default 3). The app sends no input.
- Output: `{ synced: boolean, lastSyncAt: string | null, days, failedTypes }`
- Demo response: `Fixtures/sync_health.json`

### `get_health_day`

One day in detail, fetched live from Google Health, for the Health section pages (Sleep, Steps, Resting heart rate, Active zone minutes).

- Input: `{ date: "YYYY-MM-DD" }` (Luke's time zone)
- Output: the day's summary fields (as in a `get_health` day: `date`, `steps`, … `sleep`, `workouts`) plus:
  - `stepsByHour`: 24 numbers from local midnight, `null` for an hour with nothing recorded.
  - `heartRate`: `[{ time: ISO, bpm, min, max }]` in 5-minute buckets.
  - `sleepStages`: `[{ stage: "AWAKE" | "LIGHT" | "DEEP" | "REM" (or "ASLEEP" / "RESTLESS" for classic nights), start: ISO, end: ISO }]` for the night that ended that morning. A night can be split in two with a gap.
- The app keeps each date's answer while it runs (and saved, for offline) and fetches it again on pull to refresh.
- Demo response: `Fixtures/get_health_day.json` (input `{"date": "2026-11-21"}`), made to match that day in `get_health.json`. Demo mode answers every date with it.

### `get_health_raw`

Google's own saved data points for one day. The app doesn't use it.

### `disconnect_health`

Forget the Fitbit connection and stop syncing. Sent directly, never queued.

- Input: `{  }`

Connecting happens on the computer (Health on the website). The phone has no Connect button, because Google blocks its sign-in inside embedded web views.
