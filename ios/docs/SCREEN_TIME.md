# Screen Time

Luke asked (22 Nov 2026) for the plumbing to control his own screen time from LukeOS: block certain apps until certain tasks are done, or until enough time is logged in the focus timer. The same day he asked for saved **protocols** he can switch on as he likes, each with its own **strictness**: "one protocol where it blocked linkedin until i did my laundry, or another protocol that blocked youtube and there was a 10 minute cooldown to unblock it". The page under More is still a plain first version; the parts underneath are meant to stay.

## A protocol

| Part | What it is |
| --- | --- |
| Name, On | Luke's label and its switch. Any number can be on at once; iOS blocks everything any of them blocks. |
| Apps | Apps, categories and websites from Apple's picker. |
| Until | Focus minutes for the day and/or picked LukeOS tasks. All of it must be done to unlock. Focus minutes start again at midnight; tasks count until done; a deleted task drops out. With nothing here, the apps are blocked for as long as the protocol is on. |
| Strictness | **Off any time**: the switch works whenever. **Cooldown**: Luke asks to unlock (in LukeOS or on the block screen), waits the set minutes, and the apps open for 15 min, 30 min, 1 hour or the rest of the day, then lock again. **Until it's done**: no way out except doing what "Until" asks (only offered when "Until" has something in it). |

While a Cooldown or Until-it's-done protocol is blocking, it is **locked**: it can't be switched off, changed or deleted in LukeOS.

## How it works

Apple's Screen Time frameworks, with Luke approving LukeOS for himself ("individual" authorization, no Family Sharing):

| Piece | Where | What it does |
| --- | --- | --- |
| `BlockProtocol`, `BlockState`, `BlockProgress`, `ScreenBlock` | `ScreenTime/Shared/ScreenBlock.swift` | A protocol, where it stands (`off`, `blocked`, `cooling`, `open`, `done`), what the app last knew about the day, and the functions that decide and tell iOS. Each protocol has its own `ManagedSettingsStore` (`lukeos.protocol.<id>`). Saved in the App Group so the extensions can read it. |
| `ScreenTime` | `LukeOS/Features/ScreenTime/ScreenTime.swift` | The app's side: asks for permission, reads today's focus time (`get_focus_stats`) and the picked tasks (`get_task`), then blocks or unlocks. Runs when the app comes to the front, when focus time is saved, when a task is ticked in the app, and when the page opens. |
| `ScreenTimeScreen`, `ProtocolScreen` | `LukeOS/Features/ScreenTime/ScreenTimeScreen.swift` | The list of protocols with switches, and one protocol's page. |
| `LukeOSScreenTimeMonitor` | `ScreenTime/Monitor` | An extension iOS wakes without the app: at midnight (focus minutes start again), when a cooldown's wait ends (unlock) and when its open time ends (lock again). |
| `LukeOSScreenTimeShield` | `ScreenTime/Shield` | The screen shown over a blocked app: the protocol's name, what is left, and "Unlock in 10 min" for a cooldown. |
| `LukeOSScreenTimeAction` | `ScreenTime/Action` | What the block screen's buttons do: OK closes the app, "Unlock in…" starts the cooldown. |

A cooldown is timed by one DeviceActivity stretch per protocol: its warning fires when the wait is over, its end when the apps lock again. iOS refuses stretches shorter than 15 minutes, which is why the shortest open time is 15 minutes.

## Adding to it

- A new condition (a list, a project, a time of day): a field on `BlockProtocol` (decode it with `decodeIfPresent`), what the app knows about it on `BlockProgress`, a line in `state` and `remaining`, the reading of it in `ScreenTime.refresh`, and a row on the page.
- A new strictness: a case on `Strictness`, and its rule in `BlockProtocol.state` and `locked`.

## Limits to know about

- **The phone only unlocks a task or focus protocol when LukeOS on the phone learns the work is done.** Focus time logged or a task ticked in the iPhone app unlocks at once. Done on the Mac or by Claude, the apps unlock the next time LukeOS is opened on the phone. A silent push from the server would close that gap; not built. Cooldowns don't have this limit.
- Offline, a ticked task unlocks straight away; focus time only counts once it has reached the server.
- Apple never tells the app which apps were picked, only opaque tokens, so the page can show counts, not names, and protocols live on this phone only (not in the LukeOS database, not visible to Claude).
- The way out of a locked protocol is iOS itself: Settings › Screen Time › Apps with Screen Time Access, turn LukeOS off. Ticking a task without doing it also unlocks. It is a strong nudge, not a vault.
- Signing: the Family Controls entitlement (`com.apple.developer.family-controls`) is used in its development form, which a paid team gets without asking Apple. An App Store or TestFlight build would need Apple's approval for the distribution form.
