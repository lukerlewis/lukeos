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
- **From Claude** (`/from-claude`): everything Claude made (notes, tasks,
  projects), filterable by routine, with a New count since Luke last looked
  (`src/core/from-claude.ts`).
- **Dates**: due dates are plain days (`YYYY-MM-DD`). "Today" uses Luke's time
  zone, which the app saves from his device (`set_time_zone`).
- **Deleting** only sets `deleted_at` (Trash, kept 30 days); deleting a
  project trashes its tasks and notes too.

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
