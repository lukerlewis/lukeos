import SwiftUI

/// More › Dictation: turn the mic on, try it, pick the model, add the keyboard.
struct DictationScreen: View {
    @State private var dictation = Dictation.shared

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
