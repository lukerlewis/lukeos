import SwiftUI

/// Sign in with a code made on a signed-in device (Settings > Devices on the web).
struct SignInView: View {
    @Environment(AppModel.self) private var app
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Image("Logo")
                .resizable()
                .frame(width: 88, height: 88)
                .clipShape(.rect(cornerRadius: 20))
                .padding(.bottom, 22)
            Text("LukeOS").textStyle(.title, medium: true, color: .ink)
            Text("Enter the code from Settings › Devices.")
                .textStyle(.preview, color: .mutedText)
                .padding(.top, 6)

            TextField("", text: $code, prompt: Text("ABCDE-23456").foregroundStyle(Color.disabled))
                .font(.geistMono(size: 22))
                .multilineTextAlignment(.center)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .submitLabel(.go)
                .focused($focused)
                .onSubmit(submit)
                .padding(.vertical, 14)
                .background(Color.card, in: .rect(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.strokeStrong, lineWidth: 1))
                .padding(.top, 28)
                .onChange(of: code) { _, new in
                    error = nil
                    let f = format(new.contains("/") ? String(new.split(separator: "/").last ?? "") : new)
                    if f != new { code = f }
                }

            PasteButton(payloadType: String.self) { items in
                guard let text = items.first else { return }
                Task { @MainActor in
                    code = format(text.contains("/") ? String(text.split(separator: "/").last ?? "") : text)
                    submit()
                }
            }
            .buttonBorderShape(.capsule)
            .labelStyle(.titleAndIcon)
            .padding(.top, 14)

            if let error {
                Text(error).textStyle(.meta, color: .notification).padding(.top, 10)
            }

            Spacer()

            Button(action: submit) {
                if busy { ProgressView().tint(.onSolid) } else { Text("Sign in") }
            }
            .buttonStyle(.solid)
            .disabled(code.filter(\.isLetter).count + code.filter(\.isNumber).count < 6 || busy)
            .padding(.bottom, 8)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
        .background(Color.page.ignoresSafeArea())
        .onAppear { focused = true }
    }

    /// Upper case, with the dash after five characters.
    private func format(_ s: String) -> String {
        let raw = s.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(10)
        return raw.count > 5 ? "\(raw.prefix(5))-\(raw.dropFirst(5))" : String(raw)
    }

    private func submit() {
        guard !busy else { return }
        busy = true
        Task {
            do {
                try await LukeAPI.shared.signIn(code: code)
                app.signedIn = true
                await Push.registerIfAllowed(ask: true)
            } catch {
                self.error = (error as? APIError) == .offline ? "You're offline." : "That code didn't work."
            }
            busy = false
        }
    }
}
