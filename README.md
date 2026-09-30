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
- **Dates**: due dates are plain days (`YYYY-MM-DD`). "Today" uses Luke's time
  zone, which the app saves from his device (`set_time_zone`).
- **Deleting** only sets `deleted_at` (Trash, kept 30 days); deleting a
  project trashes its tasks too.

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
