import SwiftUI
import WebKit

/// A LukeOS page from the website, signed in with the app's token, for the parts that live on the web
/// (Whiteboard, Work archive, Portfolio, Agents, notes with tables).
struct WebScreen: View {
    var path: String
    var title: String?
    /// Called when the page reaches this path (e.g. "/health/connected" after signing in).
    var onReach: (path: String, action: () -> Void)? = nil
    @State private var page = WebPage()

    var body: some View {
        WebView(page)
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle(title ?? page.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if page.isLoading { ProgressView() } else {
                        Button { page.reload() } label: { Image(systemName: "arrow.clockwise") }
                    }
                }
            }
            .onChange(of: page.url) { _, url in
                if let onReach, let url, url.path().hasPrefix(onReach.path) { onReach.action() }
            }
            .task {
                if let cookie = LukeAPI.shared.sessionCookie {
                    await WKWebsiteDataStore.default().httpCookieStore.setCookie(cookie)
                }
                page.load(URLRequest(url: LukeAPI.shared.fileURL(path)))
            }
    }
}

/// The same, in a sheet with a Done button.
struct WebSheet: View {
    var path: String
    var title: String?
    /// Closes the sheet by itself when the page reaches this path.
    var closeOn: String? = nil
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            WebScreen(path: path, title: title, onReach: closeOn.map { p in (path: p, action: { dismiss() }) })
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(role: .close) { dismiss() }
                    }
                }
        }
    }
}

extension WKHTTPCookieStore {
    func setCookie(_ cookie: HTTPCookie) async {
        await withCheckedContinuation { c in setCookie(cookie) { c.resume() } }
    }
}
