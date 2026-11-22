import SwiftUI
import WebKit

/// A LukeOS page from the website, signed in with the app's token, for the parts that live on the web
/// (Whiteboard, Work archive, Portfolio, Agents, notes with tables).
struct WebScreen: View {
    var path: String
    var title: String?
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
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            WebScreen(path: path, title: title)
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
