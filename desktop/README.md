# LukeOS for Mac

The live web app in its own window, with a Claude panel on the right that runs
Claude Code (the real CLI, signed in with Luke's subscription). Claude reaches
LukeOS through the same connector it uses everywhere else.

- **⌘J** shows or hides the panel. Drag its left edge to resize it.
- **Right-click** a task for "Ask Claude about this". Anything else offers
  "Ask Claude about this page", and selected text "Ask Claude about this text".
  The web app marks things with `data-ask-claude` (`src/lib/ask-claude.ts`).
- Claude Code runs in `~/LukeOS`, which gets a short `CLAUDE.md` the first time.
  If it isn't installed, the panel offers to install it.
- Signing in: the app can't make passkeys, so it signs in with the code from
  Settings › Devices on a signed-in device (`/api/auth/invite/use`).

Web changes go live on their own, since the window loads the site. Only changes
in this folder need a new build: the "Mac app" GitHub workflow builds it on
every change, and builds from main go on the `mac-app` release.

Run locally on a Mac: `npm install && npm start` (set `LUKEOS_URL` to point at
another copy of the site).
