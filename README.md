# LukeOS

Luke's personal app for projects, tasks and notes. Everything Luke can do in
the app, Claude can do too, through a connector (roadmap step 3).

## How it's built

- **Next.js** (App Router) with Tailwind, in the shadcn/ui style. Light and
  dark mode follow the device, with a manual choice in Settings.
- **Postgres** (Neon, added through Vercel's Storage tab) via Drizzle ORM.
  Migrations live in `drizzle/` and run automatically before every build.
- **Passkey sign-in** (Face ID, Touch ID, Windows Hello) with SimpleWebAuthn.
  There is one owner: the first passkey created claims the app, and further
  devices can only be added from a signed-in device (Settings).
- **Operations** (`src/core/operations.ts`): every action is defined once
  there with a typed input. Screens call operations, and the Claude connector
  exposes the same list as tools, so new features reach Claude automatically.
  Each operation receives an `actor` (Luke, or Claude and which routine) so
  everything can record who made it.
  Operations live in `src/core/` (`tasks.ts`, `projects.ts`, `settings.ts`)
  and are gathered in `operations.ts`. Screens read with the same core
  functions and change things by calling `/api/ops/<name>` (`src/lib/ops-client.ts`).
- **Claude connector** (`/api/mcp`): a remote MCP server whose tools are the
  operations list (`src/core/mcp.ts`). Claude signs in with standard OAuth
  (`src/lib/auth/oauth.ts`): it registers itself, Luke approves it on
  `/oauth/authorize` while signed in, and it gets its own key for that
  connection. Settings lists connections and can disconnect them. Only
  claude.ai / claude.com and local (Claude Code) return addresses are
  accepted. Anything Claude creates records `Claude` plus the routine name
  if the tool call passed one.
- **Board** (`/board`, and a Board layout on each project): cards in columns
  by when (Today, This week, This month, Later) or by status (To do, Doing,
  Done), with drag and drop from `@dnd-kit/core`. What each column covers
  and what a move changes live in `src/lib/board.ts`, shared by the screen
  and the `get_board` / `move_task` operations (`src/core/board.ts`), so a
  drag and a move by Claude do the same thing.
- **Notes** (`/notes`, and a Notes tab on each project): Markdown pages,
  edited with Tiptap (`src/components/notes/note-editor.tsx`), saved as
  Markdown so Claude reads and writes the same text. Changes save a moment
  after typing stops. Photos are shrunk in the browser (1600px, WebP) and
  stored in the database (`images` table), served to the signed-in owner at
  `/api/images/<id>`. Claude can also save a finished HTML page (format
  `html`), shown read-only in a sandboxed frame. Operations in
  `src/core/notes.ts`.
- **Documents** (`/documents`, and on each project's Notes tab): printable
  pages like Google Docs, written by Luke or Claude. A US Letter page with
  1 inch margins sits on a grey desk and is edited in place (Tiptap, saved as
  Markdown); text uses Inter at the same sizes as the PDF. Export PDF builds a
  real PDF on the server (`/api/documents/<id>/pdf`, pdfmake, fonts in
  `src/assets/fonts`, layout in `src/lib/document-pdf.ts`); phones get the
  share sheet, computers a download. Filter All / Made by me / Made by Claude;
  Claude's new or changed documents count in the sidebar. Documents have
  comment threads. This is where Claude puts what it makes; artifacts are on
  ice (`ARTIFACTS_ON` in `src/lib/features.ts` hides their Agents tab and
  tools; nothing was deleted). Operations in `src/core/documents.ts`.
- **Work archive** (`/archive`): Luke's record of work he's done, from quick
  wins to multi-year projects, kept as raw material for case studies and
  content. Each entry has a size, a stage (Raw, Drafted, Published), details,
  a confidential flag, and a story edited like a note (its first photo is the
  cover on the grid). Files up to 4 MB are stored in the database
  (`archive_files`, uploaded raw to `/api/archive/<id>/files`, served at
  `/api/files/<id>`, downloading rather than opening unless they're a PDF,
  photo, video or audio); anything bigger goes in as a link. Operations in
  `src/core/archive.ts`.
- **Inspiration** (`/inspiration`): a gallery like mymind of pictures,
  links (saved with their preview picture), videos (as links), quotes and
  PDFs, in uneven-height columns. Add with the Add sheet, by dropping or
  pasting anywhere on the page on a computer, or from the iPhone share menu
  through a Shortcut (`/api/inspiration/shortcut`, signed with a key made in
  Settings). Pictures are shrunk in the browser, then the server (sharp)
  keeps a 2000px WebP and a small gallery copy. Files live in Vercel Blob when
  a store is connected (`stored_files`, served at `/api/stored/<id>` to the
  signed-in owner), otherwise in the database. Settings shows how full the
  free 1 GB is, and the page warns at 80%. Claude tags and describes new items
  at check-in (get_inbox lists them; get_inspiration shows Claude the
  picture). Items can be linked to a project (its Inspiration tab).
  Operations in `src/core/inspiration.ts`.
- **From Claude** (`/from-claude`): everything Claude made (notes, tasks,
  projects), filterable by routine, with a New count since Luke last looked
  (`src/core/from-claude.ts`).
- **Search and commands**: the sidebar's search bar, or ⌘K / Ctrl+K anywhere,
  opens one box (`src/components/command/command-menu.tsx`) that finds tasks,
  notes and projects (the `search` operation, `src/core/search.ts`) and runs
  quick commands: new task / note / project (typing first fills in the
  title), go to any screen or project, light or dark mode. On phones the
  Search tab shows the same box as a page.
- **Dates**: due dates are plain days (`YYYY-MM-DD`). "Today" uses Luke's time
  zone, which the app saves from his device (`set_time_zone`).
- **Deleting** only sets `deleted_at`, and shows a message with Undo. Deleting
  a project trashes its tasks and notes too, with the same time, which is how
  Trash knows they belong together (`src/core/trash.ts`). The Trash screen
  (`/trash`, also in Settings) restores or deletes for good. Anything over
  30 days in Trash is deleted for good as the app is used (from the app
  layout, at most every few hours), along with photos no note or task uses
  any more, so no scheduled job is needed.

## Running locally

```bash
npm install
export DATABASE_URL=postgres://user:pass@localhost/lukeos
npm run db:migrate
npm run dev
```

After changing `src/db/schema.ts`, run `npm run db:generate` to create a new
migration file and commit it.

## Deploying

Vercel, with the GitHub repo imported and a Neon database connected from the
project's Storage tab (this sets `DATABASE_URL`). No other settings needed.
