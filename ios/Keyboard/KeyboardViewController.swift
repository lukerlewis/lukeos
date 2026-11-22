import SwiftUI
import UIKit

/// The LukeOS keyboard: one mic button that types what Luke says into any app.
/// A keyboard can't use the microphone, so the LukeOS app records and transcribes; this only sends
/// start and stop, and types the text that comes back (see `Shared/DictationLink.swift`).
final class KeyboardViewController: UIInputViewController {
    private let model = KeyboardModel()
    private var observer: NSObjectProtocol?
    private static var listening = false

    override func viewDidLoad() {
        super.viewDidLoad()
        model.controller = self

        let host = UIHostingController(rootView: KeyboardView(model: model))
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        addChild(host)
        view.addSubview(host.view)
        host.didMove(toParent: self)
        let height = view.heightAnchor.constraint(equalToConstant: KeyboardView.height)
        height.priority = .init(999)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            height,
        ])

        if !Self.listening {
            Self.listening = true
            DictationLink.listen(for: [.status])
        }
        observer = NotificationCenter.default.addObserver(forName: DictationLink.name(.status), object: nil, queue: .main) { [weak self] _ in
            self?.model.statusChanged()
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        model.showsGlobe = needsInputModeSwitchKey
        model.appeared()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        model.disappeared()
    }

    /// Opens the LukeOS app to turn the mic on. Keyboards have no direct way to open an app, so this
    /// walks up to the app the keyboard is showing in and asks it to open the link.
    func openApp() {
        var responder: UIResponder? = self
        while let current = responder {
            if let application = current as? UIApplication {
                application.open(DictationLink.armURL, options: [:], completionHandler: nil)
                return
            }
            responder = current.next
        }
        extensionContext?.open(DictationLink.armURL, completionHandler: nil)
    }
}

@MainActor
final class KeyboardModel: ObservableObject {
    enum Phase: Equatable {
        case idle, opening, recording(since: Date), transcribing
    }

    @Published var phase: Phase = .idle
    @Published var showsGlobe = false
    @Published var needsAccess = false
    weak var controller: KeyboardViewController?

    /// Waiting for the app to answer a "start". No answer means the app isn't running.
    private var waiting: Task<Void, Never>?
    private var giveUp: Task<Void, Never>?
    private var consumed: String? {
        get { UserDefaults.standard.string(forKey: "dictationConsumed") }
        set { UserDefaults.standard.set(newValue, forKey: "dictationConsumed") }
    }

    func appeared() {
        needsAccess = controller?.hasFullAccess == false
        // Anything dictated before now belongs to another text field.
        consumed = DictationLink.read().resultID ?? consumed
        DictationLink.post(.ping)
    }

    func disappeared() {
        if case .recording = phase { DictationLink.post(.cancel) }
        waiting?.cancel()
        giveUp?.cancel()
        phase = .idle
    }

    func micTapped() {
        guard !needsAccess else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        switch phase {
        case .idle:
            DictationLink.post(.start)
            waiting?.cancel()
            waiting = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(600))
                guard !Task.isCancelled else { return }
                self?.open()
            }
        case .recording:
            DictationLink.post(.stop)
            phase = .transcribing
            expire(after: 45)
        case .opening, .transcribing:
            break
        }
    }

    func cancelTapped() {
        DictationLink.post(.cancel)
        giveUp?.cancel()
        phase = .idle
    }

    /// The app wrote a new status: follow it, and type any new text.
    func statusChanged() {
        let status = DictationLink.read()
        let wasWaiting = waiting != nil
        waiting?.cancel()
        waiting = nil
        switch status.phase {
        case .recording:
            if case .recording = phase {} else { phase = .recording(since: Date()) }
            expire(after: 320)
        case .transcribing:
            phase = .transcribing
        case .ready:
            giveUp?.cancel()
            if let id = status.resultID, id != consumed, let text = status.text, !text.isEmpty {
                consumed = id
                insert(text)
            }
            if phase != .opening { phase = .idle }
        case .off:
            giveUp?.cancel()
            // The app is running but the mic is off: open it to turn the mic on.
            if wasWaiting { open() } else if phase != .opening { phase = .idle }
        }
    }

    private func open() {
        waiting = nil
        phase = .opening
        controller?.openApp()
        expire(after: 3)
    }

    /// Falls back to idle if the app goes quiet (it was closed, or the mic timed out).
    private func expire(after seconds: Double) {
        giveUp?.cancel()
        giveUp = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            self?.phase = .idle
        }
    }

    private func insert(_ text: String) {
        guard let proxy = controller?.textDocumentProxy else { return }
        var out = text
        if let last = proxy.documentContextBeforeInput?.last, !last.isWhitespace { out = " " + out }
        proxy.insertText(out)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    // MARK: Keys

    func space() { controller?.textDocumentProxy.insertText(" ") }
    func newline() { controller?.textDocumentProxy.insertText("\n") }
    func delete() { controller?.textDocumentProxy.deleteBackward() }
    func nextKeyboard() { controller?.advanceToNextInputMode() }
}

struct KeyboardView: View {
    static let height: CGFloat = 248
    @ObservedObject var model: KeyboardModel

    var body: some View {
        VStack(spacing: Space.m) {
            Spacer(minLength: 0)
            mic
            Text(label).textStyle(.meta, color: .mutedText).monospacedDigit()
            Spacer(minLength: 0)
            HStack(spacing: Space.s) {
                if model.showsGlobe {
                    Key(symbol: "globe") { model.nextKeyboard() }.frame(width: Size.tap + Space.s)
                }
                Key(text: "space") { model.space() }
                DeleteKey { model.delete() }.frame(width: Size.tap + Space.l)
                Key(symbol: "return") { model.newline() }.frame(width: Size.tap + Space.l)
            }
        }
        .padding(.horizontal, Space.s)
        .padding(.top, Space.s)
        .padding(.bottom, Space.xs)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var recording: Bool {
        if case .recording = model.phase { return true }
        return false
    }

    private var mic: some View {
        HStack(spacing: Space.xl) {
            Color.clear.frame(width: Size.tap, height: Size.tap)
            Button { model.micTapped() } label: {
                ZStack {
                    Circle().fill(model.needsAccess ? Color.muted : Color.ink)
                    if model.phase == .transcribing || model.phase == .opening {
                        ProgressView().tint(Color.onSolid)
                    } else {
                        Image(systemName: recording ? "stop.fill" : "mic.fill")
                            .font(.icon(.hero))
                            .foregroundStyle(model.needsAccess ? Color.disabled : Color.onSolid)
                    }
                }
                .frame(width: 84, height: 84)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(recording ? "Stop" : "Start dictation")
            Button { model.cancelTapped() } label: {
                Image(systemName: "xmark")
                    .font(.icon(.row))
                    .foregroundStyle(Color.icon)
                    .frame(width: Size.tap, height: Size.tap)
            }
            .buttonStyle(.plain)
            .opacity(recording ? 1 : 0)
            .disabled(!recording)
            .accessibilityLabel("Cancel")
        }
    }

    private var label: String {
        if model.needsAccess { return "Turn on Allow Full Access in Settings" }
        switch model.phase {
        case .idle: return "Tap to talk"
        case .opening: return "Opening LukeOS"
        case .recording: return "Listening"
        case .transcribing: return "Writing"
        }
    }
}

/// A key in the bottom row.
private struct Key: View {
    var text: String?
    var symbol: String?
    var action: () -> Void

    init(text: String? = nil, symbol: String? = nil, action: @escaping () -> Void) {
        self.text = text
        self.symbol = symbol
        self.action = action
    }

    var body: some View {
        Button(action: action) { KeyFace(text: text, symbol: symbol) }
            .buttonStyle(.plain)
    }
}

private struct KeyFace: View {
    var text: String?
    var symbol: String?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: Radius.control).fill(Color.card)
            if let text { Text(text).textStyle(.control, color: .text) }
            if let symbol { Image(systemName: symbol).font(.icon(.row)).foregroundStyle(Color.text) }
        }
        .frame(maxWidth: .infinity)
        .frame(height: Size.tap)
        .contentShape(.rect)
    }
}

/// Delete: one tap removes a letter, holding keeps removing.
private struct DeleteKey: View {
    var action: () -> Void
    @State private var repeating: Task<Void, Never>?

    var body: some View {
        KeyFace(symbol: "delete.left")
            .onLongPressGesture(minimumDuration: 60, maximumDistance: 40, perform: {}) { pressing in
                repeating?.cancel()
                guard pressing else { return }
                action()
                repeating = Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(400))
                    while !Task.isCancelled {
                        action()
                        try? await Task.sleep(for: .milliseconds(80))
                    }
                }
            }
            .accessibilityLabel("Delete")
            .accessibilityAddTraits(.isButton)
    }
}
