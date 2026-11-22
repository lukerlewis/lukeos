import FamilyControls
import SwiftUI

/// Screen Time (under More): pick apps, and what has to be done before they unlock.
/// A first, plain version of the page; the rule itself lives in `ScreenTime` and `ScreenBlock`.
struct ScreenTimeScreen: View {
    @State private var model = ScreenTime.shared
    @State private var pickingApps = false
    @State private var pickingTasks = false

    var body: some View {
        @Bindable var model = model
        List {
            if !model.allowed {
                Section {
                    Button { Task { await model.allow() } } label: {
                        Text("Allow Screen Time").textStyle(.control, medium: true, color: .ink)
                    }
                    .cardRow()
                }
            } else {
                Section {
                    Toggle(isOn: $model.rule.on) { Text("Block apps").textStyle(.control, color: .text) }
                        .tint(Color.ink)
                        .cardRow()
                    if model.rule.on {
                        row("Now", status).cardRow()
                    }
                }
                Section {
                    Button { pickingApps = true } label: { row("Apps", appsLabel, chevron: true) }
                        .cardRow()
                }
                Section {
                    Stepper(value: $model.rule.focusMinutes, in: 0...600, step: 5) {
                        VStack(alignment: .leading, spacing: Space.line) {
                            Text("Focus time").textStyle(.control, color: .text)
                            Text(focusLabel).textStyle(.meta, color: .mutedText).monospacedDigit()
                        }
                    }
                    .cardRow()
                    ForEach(model.picked) { task in
                        HStack(spacing: Space.m) {
                            StatusCircle(status: task.status, size: Size.tick)
                            Text(task.title).textStyle(.control, color: task.status == .done ? .mutedText : .text).lineLimit(2)
                        }
                        .cardRow()
                        .swipeActions {
                            Button("Remove") { model.remove(task.id) }.tint(Color.swipeSecondary)
                        }
                    }
                    Button { pickingTasks = true } label: {
                        Label { Text("Add tasks").textStyle(.control, color: .subtleText) } icon: {
                            Image(systemName: "plus").foregroundStyle(Color.icon)
                        }
                    }
                    .cardRow()
                } header: { SectionTitle(text: "Until") }
            }
        }
        .listStyle(.insetGrouped)
        .pageBackground()
        .navigationTitle("Screen Time")
        .familyActivityPicker(isPresented: $pickingApps, selection: $model.rule.apps)
        .sheet(isPresented: $pickingTasks) { ScreenTimeTaskPicker() }
        .refreshable { await model.refresh(force: true) }
        .task { await model.refresh(force: true) }
    }

    private var status: String {
        if !model.rule.hasApps { return "No apps picked" }
        if !model.blocked { return "Unlocked" }
        let left = model.remaining
        return left.isEmpty ? "Blocked" : left.prefix(1).uppercased() + left.dropFirst()
    }

    private var appsLabel: String {
        let apps = model.rule.apps
        func count(_ n: Int, _ one: String, _ many: String) -> String? { n == 0 ? nil : n == 1 ? "1 \(one)" : "\(n) \(many)" }
        let parts = [
            count(apps.applicationTokens.count, "app", "apps"),
            count(apps.categoryTokens.count, "category", "categories"),
            count(apps.webDomainTokens.count, "website", "websites"),
        ].compactMap { $0 }
        return parts.isEmpty ? "None" : parts.joined(separator: ", ")
    }

    private var focusLabel: String {
        model.rule.focusMinutes == 0 ? "Off" : "\(model.focusMinutesToday) of \(model.rule.focusMinutes) min today"
    }

    private func row(_ title: String, _ value: String, chevron: Bool = false) -> some View {
        HStack(spacing: Space.s) {
            Text(title).textStyle(.control, color: .text)
            Spacer(minLength: Space.m)
            Text(value).textStyle(.control, color: .mutedText).lineLimit(1)
            if chevron {
                Image(systemName: "chevron.right").font(.icon(.meta)).foregroundStyle(Color.disabled)
            }
        }
    }
}

/// Open tasks to add to the rule.
struct ScreenTimeTaskPicker: View {
    @State private var model = ScreenTime.shared
    @State private var store = TaskStore.shared
    @State private var chosen: Set<String> = []
    @Environment(\.dismiss) private var dismiss

    private var open: [LukeTask] {
        store.tasks.filter { $0.status != .done && !model.rule.taskIds.contains($0.id) }.sorted(by: TaskStore.standardOrder)
    }

    var body: some View {
        NavigationStack {
            List(open, selection: $chosen) { t in
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text(t.title).textStyle(.control, color: .text)
                    HStack(spacing: Space.s) {
                        Tag(t.bucket.label)
                        if let p = t.project { ProjectChip(name: p.name, color: p.color) }
                    }
                }
                .cardRow()
            }
            .environment(\.editMode, .constant(.active))
            .pageBackground()
            .navigationTitle("Tasks")
            .navigationBarTitleDisplayMode(.inline)
            .overlay { if open.isEmpty { EmptyNote(text: "No open tasks.") } }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .cancel) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", role: .confirm) {
                        model.add(open.filter { chosen.contains($0.id) })
                        dismiss()
                    }
                    .disabled(chosen.isEmpty)
                }
            }
            .task { await store.load() }
        }
    }
}
