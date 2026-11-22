import SwiftUI

/// The dashboard's scratch pad: one running note that saves a moment after typing stops.
struct ScratchPadEditor: View {
    var noteId: String
    var initial: String
    @State private var text = ""
    @State private var state = "Saved"
    @State private var saveTask: Task<Void, Never>?
    @State private var started = false

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            TextField("Jot things down…", text: $text, axis: .vertical)
                .font(.geist(.body))
                .foregroundStyle(Color.text)
                .lineLimit(4...)
                .lineSpacing(4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .onChange(of: text) { old, new in
                    guard started, old != new else { return }
                    schedule(new)
                }
            Text(state).textStyle(.meta, color: .mutedText).contentTransition(.opacity)
        }
        .padding(.top, 6)
        .onAppear {
            text = initial
            DispatchQueue.main.async { started = true }
        }
        .onDisappear { saveTask?.cancel(); if state != "Saved" { save(text) } }
    }

    private func schedule(_ value: String) {
        state = "Saving…"
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            save(value)
        }
    }

    private func save(_ value: String) {
        Task {
            _ = await Repo.change("update_note", ["id": .string(noteId), "content": .string(value)])
            state = "Saved"
            Home.shared.data?.scratchPad?.content = value
        }
    }
}
