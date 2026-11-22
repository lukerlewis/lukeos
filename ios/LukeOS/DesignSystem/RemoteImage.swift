import SwiftUI
import UIKit

/// Loads pictures LukeOS serves (`/api/images/<id>`, `/api/stored/<id>`) with the sign-in token,
/// keeping them on the phone for good, since they never change.
actor ImageStore {
    static let shared = ImageStore()

    private let memory = NSCache<NSString, UIImage>()
    private let dir: URL = {
        let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "Images")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    private func file(_ path: String) -> URL {
        dir.appending(path: path.replacingOccurrences(of: "[^A-Za-z0-9._-]", with: "_", options: .regularExpression))
    }

    func cached(_ path: String) -> UIImage? { memory.object(forKey: path as NSString) }

    func image(_ path: String) async -> UIImage? {
        if let hit = memory.object(forKey: path as NSString) { return hit }
        var data: Data?
        if SharedConfig.isDemo, let local = await DemoServer.shared.localFile(path) {
            data = try? Data(contentsOf: local)
        } else if let saved = try? Data(contentsOf: file(path)) {
            data = saved
        } else {
            let url = LukeAPI.shared.fileURL(path)
            var req = URLRequest(url: url)
            if url.host() == LukeAPI.shared.baseURL.host(), let token = TokenStore.token {
                req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
            }
            if let (d, r) = try? await LukeAPI.shared.session.data(for: req), (r as? HTTPURLResponse)?.statusCode ?? 0 < 300 {
                data = d
                try? d.write(to: file(path))
            }
        }
        guard let data, let image = UIImage(data: data) else { return nil }
        let ready = await image.byPreparingForDisplay() ?? image
        memory.setObject(ready, forKey: path as NSString)
        return ready
    }
}

/// A picture from LukeOS, fading in once loaded.
struct RemoteImage: View {
    var path: String?
    var contentMode: ContentMode = .fit
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            } else {
                Rectangle().fill(Color.muted)
                    .aspectRatio(contentMode == .fit ? 4 / 3 : nil, contentMode: .fit)
            }
        }
        .task(id: path) {
            guard let path, !path.isEmpty else { return }
            if let hit = await ImageStore.shared.cached(path) { image = hit; return }
            let loaded = await ImageStore.shared.image(path)
            withAnimation(.easeOut(duration: 0.2)) { image = loaded }
        }
    }
}
