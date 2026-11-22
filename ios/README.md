# LukeOS for iPhone

A native SwiftUI app for LukeOS (iOS 26.1 or later) with Liquid Glass, built only for Luke's own iPhone and not for the App Store. It uses the same back end as the website.

## Put it on the iPhone (or update it)

1. Unlock the iPhone. It should be on the same Wi-Fi as the Mac, or plugged in with a cable.
2. Open Terminal on the Mac and run:

```bash
~/Developer/lukeos/ios/install-on-iphone.sh
```

That's it. The script gets the latest code, builds the app and installs it. The first build takes a few minutes.

The first time only, there are three more things to do:

- On the iPhone, go to Settings › General › VPN & Device Management and tap the developer (Lewis Design, LLC) to trust it. You may not see this step.
- Sign in from a signed-in device: on the website, go to Settings › Devices that can sign in › Add a new device. Type the code into the app, or copy the link and tap Paste.
- Allow notifications when the app asks.

A build made this way lasts a year. Run the command again to renew it or to update the app.

## What's where

| Folder | What it holds |
| --- | --- |
| `LukeOS/App` | App start, tabs, sign-in, Siri shortcuts |
| `LukeOS/Core` | Talking to the server, the offline copy and queue, notifications, web pages |
| `LukeOS/DesignSystem` | Luke's greys, Geist and every shared component (see its README) |
| `LukeOS/Features` | One folder per section: Dashboard, Tasks, Notes, Focus, Music, Messages, More, Comments |
| `Shared` | Code shared with the widget and the share extension: tokens, models, API, smart dates |
| `Widgets` | The Today widget and the focus Live Activity |
| `Share` | "Save to LukeOS" in the share sheet |
| `Keyboard` | The LukeOS keyboard: a mic button that types what Luke says into any app |
| `Fixtures` | Real server answers, used by demo mode and the tests |
| `docs` | The API guide and screen notes |
| `screenshots` | How every screen looks, light and dark |

## Dictation

More › Dictation and the LukeOS keyboard turn speech into text with Whisper, on the phone, with no service and no cost.

- A keyboard can't use the microphone, so the app does the recording. The keyboard's mic button sends "start" and "stop" to the app and types the text that comes back (`Shared/DictationLink.swift`).
- The first tap in a while opens LukeOS to turn the mic on; swipe back and tap again. The mic then stays on for 15 minutes after it was last used (`Dictation.staysOn`).
- The model (Fast, Balanced, Most accurate) is downloaded once from More › Dictation and kept in the app's Documents.
- Set up once: Settings › General › Keyboard › Keyboards › Add New Keyboard › LukeOS, then tap LukeOS in that list and turn on Allow Full Access (needed for the keyboard and the app to share a folder).

## For developers

- The project is made from `project.yml` with XcodeGen (`xcodegen generate`). The generated `LukeOS.xcodeproj` is committed so Xcode can open it straight away.
- **Demo mode:** run the "LukeOS Demo" scheme, or launch with `-demo`, to use the bundled fixtures instead of the network. Other launch arguments for checks: `-area work`, `-layout board`, `-tab focus`, `-link /notes/<id>`, `-focusMode sprint`, `-musicTab playlists`, `-autoplay -player`, `-widgetGallery`. Debug builds also take `-recordWrites -exerciseWrites`.
- **Server:** `LUKEOS_BASE_URL` in `project.yml` (default `https://lukeos-kappa.vercel.app`). Pass `-baseURL http://localhost:3000` at launch to use a local server.
- **Tests:** every fixture decodes, plus checks for smart dates and Markdown (`xcodebuild test -scheme LukeOS -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max'`).
- **Offline:** every answer is kept on the phone, so screens open at once. Changes made offline wait in a queue and are sent when the phone is back online. The last write wins.
- **Signing:** team 563YN34NMT (Lewis Design, LLC), automatic. The app, widget and share extension share the App Group `group.com.lewisdesign.lukeos` and a keychain group for the sign-in token.
