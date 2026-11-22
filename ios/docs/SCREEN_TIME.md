# Screen Time

Luke asked (22 Nov 2026) for the plumbing to control his own screen time from LukeOS: block certain apps until certain tasks are done, or until enough time is logged in the focus timer. This is that plumbing plus a plain first page under More. The page is provisional; the parts underneath are meant to stay.

## How it works

Apple's Screen Time frameworks, with Luke approving LukeOS for himself ("individual" authorization, no Family Sharing):

| Piece | Where | What it does |
| --- | --- | --- |
| `BlockRule`, `BlockProgress`, `ScreenBlock` | `ScreenTime/Shared/ScreenBlock.swift` | The rule (on or off, the picked apps, focus minutes, task ids), what the app last knew about the day, and the one function that decides "blocked or not" and tells iOS (`ManagedSettingsStore` named `lukeos.block`). Saved in the App Group so the extensions can read it. |
| `ScreenTime` | `LukeOS/Features/ScreenTime/ScreenTime.swift` | The app's side: asks for permission, reads today's focus time (`get_focus_stats`) and the picked tasks (`get_task`), then blocks or unlocks. Runs when the app comes to the front, when focus time is saved, when a task is ticked in the app, and when the page opens. |
| `ScreenTimeScreen` | `LukeOS/Features/ScreenTime/ScreenTimeScreen.swift` | The page: Block apps switch, Apps (Apple's own picker), Until: focus time and tasks. |
| `LukeOSScreenTimeMonitor` | `ScreenTime/Monitor` | An extension iOS wakes at midnight, without the app: yesterday's focus time stops counting and the apps lock again. |
| `LukeOSScreenTimeShield` | `ScreenTime/Shield` | The screen shown over a blocked app: "Blocked by LukeOS" and what is left to do. |

Rules of the rule:

- On, with apps picked and nothing asked for: blocked until switched off.
- Focus minutes count per day and start again at midnight. Tasks count until they are done; a deleted task drops out of the rule.
- Everything asked for must be met to unlock.

## Adding a new kind of rule

Add a field to `BlockRule`, what the app knows about it to `BlockProgress`, a line in `ScreenBlock.shouldBlock` and `remaining`, the reading of it in `ScreenTime.refresh`, and a row on the page. Ideas Luke mentioned or that follow naturally: several rules with different apps, "everything in Signal", a start time, a daily allowance once unlocked.

## Limits to know about

- **The phone only unlocks when LukeOS on the phone learns the work is done.** Focus time logged or a task ticked in the iPhone app unlocks at once. Done on the Mac or by Claude, the apps unlock the next time LukeOS is opened on the phone. A silent push from the server would close that gap; not built.
- Offline, a ticked task unlocks straight away; focus time only counts once it has reached the server.
- Apple never tells the app which apps were picked, only opaque tokens, so the page can show counts, not names, and the rule lives on this phone only (not in the LukeOS database, not visible to Claude).
- Luke can always switch the rule off in LukeOS, or turn off LukeOS under Settings › Screen Time › Apps with Screen Time Access. It is a nudge, not a lock.
- Signing: the Family Controls entitlement (`com.apple.developer.family-controls`) is used in its development form, which a paid team gets without asking Apple. An App Store or TestFlight build would need Apple's approval for the distribution form.
