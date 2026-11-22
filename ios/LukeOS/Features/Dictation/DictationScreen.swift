import SwiftUI

/// More › Dictation: turn the mic on, try it, pick the model, add the keyboard.
struct DictationScreen: View {
    @State private var dictation = Dictation.shared
    @State private var history = DictationHistory.shared

    var body: some View {
        @Bindable var dictation = dictation
        Form {
            Section {
                LabeledContent("Microphone", value: micLabel)
                if dictation.micDenied {
                    Button("Allow the microphone in Settings") { openSettings() }
                } else if dictation.phase == .off {
                    Button("Turn on") { Task { await dictation.turnOn() } }
                } else {
                    Button("Turn off") { dictation.turnOff() }
                }
            } footer: {
                if dictation.openedByKeyboard, dictation.phase != .off {
                    Text("Swipe back to keep typing.").font(.geist(.meta))
                }
            }

            Section("Try it") {
                Button(tryLabel) {
                    Task {
                        switch dictation.phase {
                        case .off:
                            await dictation.turnOn()
                            dictation.start()
                        case .ready: dictation.start()
                        case .recording: await dictation.stop()
                        case .transcribing: break
                        }
                    }
                }
                .disabled(dictation.phase == .transcribing)
                if !dictation.lastText.isEmpty {
                    Text(dictation.lastText).textStyle(.body, color: .text).textSelection(.enabled)
                }
                if let took = dictation.lastTook, !dictation.lastText.isEmpty {
                    LabeledContent("Took", value: String(format: "%.1f s", took))
                }
                if let error = dictation.lastError {
                    Text(error).textStyle(.meta, color: .mutedText)
                }
            }

            if !history.entries.isEmpty {
                Section {
                    NavigationLink {
                        DictationHistoryScreen()
                    } label: {
                        LabeledContent("History", value: "\(history.entries.count)")
                    }
                }
            }

            Section("Model") {
                Picker("Model", selection: $dictation.model) {
                    ForEach(DictationModel.allCases) { m in
                        Text("\(m.title) · \(m.size)").tag(m)
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
                LabeledContent("Status", value: modelLabel)
                if dictation.modelState == .idle || isFailed {
                    Button("Download") { Task { await dictation.loadModel() } }
                }
            }

            Section("Keyboard") {
                Button("Add the LukeOS keyboard") { openSettings() }
            }
        }
        .font(.geist(.control))
        .scrollContentBackground(.hidden)
        .background(Color.page)
        .navigationTitle("Dictation")
        .onDisappear { dictation.openedByKeyboard = false }
    }

    private var micLabel: String {
        switch dictation.phase {
        case .off: "Off"
        case .ready: "On"
        case .recording: "Listening"
        case .transcribing: "Writing"
        }
    }

    private var tryLabel: String {
        switch dictation.phase {
        case .off, .ready: "Start talking"
        case .recording: "Stop"
        case .transcribing: "Writing…"
        }
    }

    private var isFailed: Bool {
        if case .failed = dictation.modelState { return true }
        return false
    }

    private var modelLabel: String {
        switch dictation.modelState {
        case .idle: "Not loaded"
        case .downloading(let fraction): "Downloading \(Int(fraction * 100))%"
        case .loading: "Getting ready"
        case .ready: "Ready"
        case .failed(let why): why
        }
    }

    private func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
    }
}

/// More › Dictation › History: everything dictated in the last week. Tap to copy.
struct DictationHistoryScreen: View {
    @State private var history = DictationHistory.shared
    @State private var retrying: String?
    @State private var confirmClear = false

    var body: some View {
        List {
            ForEach(history.entries) { entry in
                row(entry)
                    .cardRow()
                    .swipeActions {
                        Button("Delete", role: .destructive) { history.remove(entry.id) }
                    }
            }
        }
        .listStyle(.insetGrouped)
        .pageBackground()
        .navigationTitle("History")
        .toolbar {
            if !history.entries.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Clear") { confirmClear = true }
                }
            }
        }
        .confirmationDialog("Delete all saved dictation?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Delete all", role: .destructive) { history.clear() }
        }
        .overlay {
            if history.entries.isEmpty { EmptyNote(text: "Nothing in the last 7 days", symbol: "mic") }
        }
        .onAppear { history.prune() }
    }

    @ViewBuilder
    private func row(_ entry: DictationEntry) -> some View {
        if entry.failed {
            VStack(alignment: .leading, spacing: Space.line) {
                Text("Couldn't be written").textStyle(.control, color: .text)
                Text(when(entry)).textStyle(.meta, color: .mutedText)
                Button(retrying == entry.id ? "Writing…" : "Try again") {
                    retrying = entry.id
                    Task {
                        await Dictation.shared.retry(entry)
                        retrying = nil
                    }
                }
                .buttonStyle(.borderless)
                .font(.geist(.control, medium: true))
                .foregroundStyle(Color.ink)
                .disabled(retrying != nil)
                .frame(minHeight: Size.tap)
            }
        } else {
            Button {
                UIPasteboard.general.string = entry.text
                Toasts.shared.show("Copied")
            } label: {
                VStack(alignment: .leading, spacing: Space.line) {
                    Text(entry.text).textStyle(.body, color: .text).multilineTextAlignment(.leading)
                    Text(when(entry)).textStyle(.meta, color: .mutedText)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
        }
    }

    private func when(_ entry: DictationEntry) -> String {
        entry.date.formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }
}
