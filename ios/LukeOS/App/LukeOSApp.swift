import SwiftUI
import UserNotifications

@main
struct LukeOSApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var app = AppModel.shared
    @State private var toasts = Toasts.shared
    @AppStorage("appearance", store: SharedConfig.defaults) private var appearance = "system"

    init() { Appearance.apply() }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .environment(toasts)
                .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
                .tint(.ink)
                .onOpenURL { app.handle(url: $0) }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var phase

    var body: some View {
        Group {
            if SharedConfig.isDemo, ProcessInfo.processInfo.arguments.contains("-widgetGallery") {
                WidgetGallery()
            } else if app.signedIn {
                MainTabs()
                    .transition(.opacity)
            } else {
                SignInView()
                    .transition(.opacity)
            }
        }
        .animation(.smooth, value: app.signedIn)
        .overlay(alignment: .bottom) { ToastView() }
        .onChange(of: phase) { _, now in
            if now == .active { Task { await Outbox.shared.flush() } }
        }
    }
}

/// The toast, floating on glass above the tab bar.
struct ToastView: View {
    @Environment(Toasts.self) private var toasts

    var body: some View {
        if let toast = toasts.current {
            HStack(spacing: Space.row) {
                Text(toast.text).textStyle(.preview, color: .text).lineLimit(2)
                if let undo = toast.undo {
                    Button("Undo") {
                        undo()
                        toasts.current = nil
                    }
                    .font(.geist(.preview, medium: true))
                    .foregroundStyle(Color.ink)
                }
            }
            .padding(.horizontal, Space.l)
            .padding(.vertical, Space.m)
            .glassEffect(.regular, in: .capsule)
            .padding(.bottom, Size.bottomClearance)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .id(toast.id)
            .animation(Motion.snappy, value: toasts.current)
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        Task { @MainActor in
            AudioPlayer.shared.configureSession()
            if AppModel.shared.signedIn, !SharedConfig.isDemo { await Push.registerIfAllowed() }
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await Push.send(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {}

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let url = response.notification.request.content.userInfo["url"] as? String
        await MainActor.run {
            if let url { AppModel.shared.open(url) }
        }
    }
}
