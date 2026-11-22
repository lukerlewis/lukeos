import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// "Save to LukeOS": a link, text or picture from any app goes to Inspiration, with an optional note.
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let model = ShareModel(context: extensionContext)
        let host = UIHostingController(rootView: ShareView(model: model))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.view.backgroundColor = .clear
        view.addSubview(host.view)
        host.didMove(toParent: self)
        Task { await model.read() }
    }
}

@MainActor @Observable
final class ShareModel {
    enum Content { case url(URL), text(String), images([Data]) }

    let context: NSExtensionContext?
    var content: Content?
    var note = ""
    var saving = false
    var error: String?

    init(context: NSExtensionContext?) { self.context = context }

    func read() async {
        let providers = (context?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        var images: [Data] = []
        for p in providers {
            if p.hasItemConformingToTypeIdentifier(UTType.url.identifier),
               let url = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL, !url.isFileURL {
                content = .url(url)
                return
            }
            if p.hasItemConformingToTypeIdentifier(UTType.image.identifier),
               let data = await Self.data(p, .image) {
                images.append(data)
            }
        }
        if !images.isEmpty { content = .images(images); return }
        for p in providers where p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let s = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                content = URL(string: s).flatMap { $0.scheme?.hasPrefix("http") == true ? Content.url($0) : nil } ?? .text(s)
                return
            }
        }
    }

    nonisolated static func data(_ p: NSItemProvider, _ type: UTType) async -> Data? {
        await withCheckedContinuation { c in
            _ = p.loadDataRepresentation(for: type) { data, _ in c.resume(returning: data) }
        }
    }

    func save() async {
        guard TokenStore.token != nil else { error = "Sign in to LukeOS first."; return }
        saving = true
        defer { saving = false }
        do {
            switch content {
            case .url(let u):
                var input: Input = ["url": .string(u.absoluteString)]
                if !note.isEmpty { input["note"] = .string(note) }
                _ = try await LukeAPI.shared.opData("add_inspiration", input)
            case .text(let t):
                var input: Input = ["text": .string(t)]
                if !note.isEmpty { input["note"] = .string(note) }
                _ = try await LukeAPI.shared.opData("add_inspiration", input)
            case .images(let list):
                for data in list {
                    let jpeg = UIImage(data: data).flatMap { Self.shrink($0).jpegData(compressionQuality: 0.85) } ?? data
                    _ = try await LukeAPI.shared.upload("api/inspiration/upload", data: jpeg, contentType: "image/jpeg")
                }
            case nil:
                return
            }
            context?.completeRequest(returningItems: nil)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func cancel() {
        context?.cancelRequest(withError: NSError(domain: "LukeOS", code: 0))
    }

    static func shrink(_ image: UIImage) -> UIImage {
        let scale = min(1, 2400 / max(image.size.width, image.size.height))
        guard scale < 1 else { return image }
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    }
}

struct ShareView: View {
    @Bindable var model: ShareModel

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    switch model.content {
                    case .url(let u):
                        Label(u.host() ?? u.absoluteString, systemImage: "link").font(.geist(.control))
                    case .text(let t):
                        Text(t).font(.geist(.control)).lineLimit(6)
                    case .images(let list):
                        ScrollView(.horizontal) {
                            HStack {
                                ForEach(Array(list.enumerated()), id: \.offset) { _, d in
                                    if let img = UIImage(data: d) {
                                        Image(uiImage: img).resizable().scaledToFill().frame(width: 90, height: 90).clipShape(.rect(cornerRadius: 10))
                                    }
                                }
                            }
                        }
                    case nil:
                        ProgressView()
                    }
                }
                if case .images = model.content {} else {
                    Section { TextField("Note", text: $model.note, axis: .vertical).font(.geist(.control)) }
                }
                if let e = model.error { Section { Text(e).foregroundStyle(Color.notification).font(.geist(.meta)) } }
            }
            .navigationTitle("Save to Inspiration")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .cancel) { model.cancel() } }
                ToolbarItem(placement: .confirmationAction) {
                    if model.saving { ProgressView() } else {
                        Button("Save", role: .confirm) { Task { await model.save() } }.disabled(model.content == nil)
                    }
                }
            }
        }
        .tint(.ink)
    }
}
