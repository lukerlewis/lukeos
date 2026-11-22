import UIKit
import UserNotifications

/// Apple notifications: ask once, then hand the device token to LukeOS.
enum Push {
    @MainActor
    static func registerIfAllowed(ask: Bool = false) async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            UIApplication.shared.registerForRemoteNotifications()
        case .notDetermined where ask:
            if (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) == true {
                UIApplication.shared.registerForRemoteNotifications()
            }
        default:
            break
        }
    }

    static func send(deviceToken: Data) async {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        SharedConfig.defaults.set(hex, forKey: "apnsToken")
        // The entitlement is "development", so the token is a sandbox one in every build.
        let environment = "sandbox"
        var req = LukeAPI.shared.request("api/push/apns")
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        let name = await MainActor.run { UIDevice.current.name }
        req.httpBody = try? JSONEncoder().encode(["deviceToken": hex, "deviceName": name, "environment": environment])
        _ = try? await LukeAPI.shared.send(req)
    }

    static func unregister() async {
        guard let hex = SharedConfig.defaults.string(forKey: "apnsToken") else { return }
        var req = LukeAPI.shared.request("api/push/apns")
        req.httpMethod = "DELETE"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONEncoder().encode(["deviceToken": hex])
        _ = try? await LukeAPI.shared.send(req)
    }
}
