import Foundation
import Observation
import UIKit

struct AppHome: Codable, Sendable {
    struct ScratchPad: Codable, Sendable { var id: String; var content: String; var updatedAt: String? }
    struct FocusSettings: Codable, Sendable, Equatable {
        var focusMinutes: Int
        var shortBreakMinutes: Int
        var longBreakMinutes: Int
        var roundsBeforeLongBreak: Int
        static let standard = FocusSettings(focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, roundsBeforeLongBreak: 4)
    }
    struct Focus: Codable, Sendable { var settings: FocusSettings; var scratchPad: String? }

    var today: String
    var timeZone: String
    var unreadMessages: Int
    var newFromClaude: Int?
    var scratchPad: ScratchPad?
    var dashboardView: DashboardView?
    var focus: Focus?
    var nextCheckIn: String?
}

/// What the app reads as it opens (`/api/app/home`): today, unread counts, the scratch pad, settings.
@MainActor @Observable
final class Home {
    static let shared = Home()

    var data: AppHome?
    var unread: Int { data?.unreadMessages ?? 0 }
    var newFromClaude: Int { data?.newFromClaude ?? 0 }

    private init() {}

    func refresh() async {
        if data == nil, let cached = await ResponseCache.shared.read("app-home"),
           let home = try? LukeAPI.decoder.decode(AppHome.self, from: cached) {
            apply(home)
        }
        do {
            let raw = try await LukeAPI.shared.getData("api/app/home")
            let home = try LukeAPI.decoder.decode(AppHome.self, from: raw)
            await ResponseCache.shared.write("app-home", raw)
            apply(home)
            // The website keeps Luke's time zone in step with his device; so does the app.
            let zone = TimeZone.current.identifier
            if !SharedConfig.isDemo, home.timeZone != zone {
                await Repo.change("set_time_zone", ["timeZone": .string(zone)])
            }
        } catch APIError.signedOut {
            NotificationCenter.default.post(name: .lukeOSSignedOut, object: nil)
        } catch {}
    }

    private func apply(_ home: AppHome) {
        data = home
        AppModel.shared.today = home.today
        if let view = home.dashboardView { TaskStore.shared.view = view }
        if let settings = home.focus?.settings { FocusTimer.shared.settings = settings }
        UNBadge.set(home.unreadMessages)
    }

    func markRead() {
        guard unread > 0 else { return }
        data?.unreadMessages = 0
        UNBadge.set(0)
        Task { await Repo.change("mark_messages_read", [:]) }
    }
}

enum UNBadge {
    @MainActor static func set(_ n: Int) {
        UNUserNotificationCenterBadge.set(n)
    }
}

import UserNotifications
enum UNUserNotificationCenterBadge {
    static func set(_ n: Int) {
        UNUserNotificationCenter.current().setBadgeCount(n)
    }
}
