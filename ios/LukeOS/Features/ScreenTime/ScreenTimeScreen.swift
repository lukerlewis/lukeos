import FamilyControls
import SwiftUI

/// Screen Time (under More): Luke's saved protocols, each with its own switch.
struct ScreenTimeScreen: View {
    @State private var model = ScreenTime.shared
    @State private var opened: String?

    var body: some View {
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
                    ForEach(model.protocols) { p in
                        HStack(spacing: Space.m) {
                            VStack(alignment: .leading, spacing: Space.line) {
                                Text(p.name.isEmpty ? "Protocol" : p.name).textStyle(.control, color: .text).lineLimit(1)
                                Text(model.summary(p)).textStyle(.meta, color: .mutedText).monospacedDigit().lineLimit(1)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(.rect)
                            .onTapGesture { opened = p.id }
                            .accessibilityAddTraits(.isButton)
                            Toggle("", isOn: Binding(get: { p.on }, set: { on in model.update(p.id) { $0.on = on } }))
                                .labelsHidden()
                                .tint(Color.ink)
                                .disabled(model.locked(p))
                        }
                        .cardRow()
                    }
                    Button { opened = model.create().id } label: {
                        Label { Text("New protocol").textStyle(.control, color: .subtleText) } icon: {
                            Image(systemName: "plus").foregroundStyle(Color.icon)
                        }
                    }
                    .cardRow()
                }
            }
        }
        .listStyle(.insetGrouped)
        .pageBackground()
        .navigationTitle("Screen Time")
        .navigationDestination(item: $opened) { ProtocolScreen(id: $0) }
        .refreshable { await model.refresh(force: true) }
        .task { await model.refresh(force: true) }
        .task { await ticking(model) }
    }
}

/// Moves the page's clock once a second while a Screen Time page is open.
@MainActor private func ticking(_ model: ScreenTime) async {
    while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(1))
        model.tick()
    }
}

/// One protocol: its name, apps, what unlocks it and how strict it is.
/// While it is locked (blocking, and not "Off any time") nothing here can be changed.
struct ProtocolScreen: View {
    var id: String
    @State private var model = ScreenTime.shared
    @State private var pickingApps = false
    @State private var pickingTasks = false
    @State private var confirmDelete = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if let p = model.find(id) {
            let locked = model.locked(p)
            List {
                Section {
                    TextField("Name", text: bind(\.name))
                        .font(.geist(.control))
                        .foregroundStyle(Color.text)
                        .disabled(locked)
                        .cardRow()
                    Toggle(isOn: bind(\.on)) { Text("On").textStyle(.control, color: .text) }
                        .tint(Color.ink)
                        .disabled(locked)
                        .cardRow()
                    if p.on { row("Now", model.summary(p)).cardRow() }
                    cooldownButton(p)
                }

                Section {
                    Button { pickingApps = true } label: { row("Apps", appsLabel(p), chevron: true) }
                        .cardRow()
                }
                .disabled(locked)

                Section {
                    Stepper(value: bind(\.focusMinutes), in: 0...600, step: 5) {
                        VStack(alignment: .leading, spacing: Space.line) {
                            Text("Focus time").textStyle(.control, color: .text)
                            Text(focusLabel(p)).textStyle(.meta, color: .mutedText).monospacedDigit()
                        }
                    }
                    .cardRow()
                    ForEach(model.tasks(of: p)) { task in
                        HStack(spacing: Space.m) {
                            StatusCircle(status: task.status, size: Size.tick)
                            Text(task.title).textStyle(.control, color: task.status == .done ? .mutedText : .text).lineLimit(2)
                        }
                        .cardRow()
                        .swipeActions {
                            Button("Remove") { model.update(id) { $0.taskIds.removeAll { $0 == task.id } } }.tint(Color.swipeSecondary)
                        }
                    }
                    Button { pickingTasks = true } label: {
                        Label { Text("Add tasks").textStyle(.control, color: .subtleText) } icon: {
                            Image(systemName: "plus").foregroundStyle(Color.icon)
                        }
                    }
                    .cardRow()
                } header: { SectionTitle(text: "Until") }
                .disabled(locked)

                Section {
                    Picker(selection: bind(\.strictness)) {
                        ForEach(Strictness.allCases, id: \.self) { s in
                            // "Until it's done" needs something to do, or there would be no way out.
                            if s != .strict || p.asksForSomething || p.strictness == .strict { Text(s.label).tag(s) }
                        }
                    } label: { Text("Strictness").textStyle(.control, color: .text) }
                    .tint(Color.mutedText)
                    .cardRow()
                    if p.strictness == .cooldown {
                        Stepper(value: bind(\.cooldownMinutes), in: 1...120) {
                            row("Wait", "\(p.cooldownMinutes) min")
                        }
                        .cardRow()
                        Picker(selection: bind(\.openMinutes)) {
                            Text("15 min").tag(15)
                            Text("30 min").tag(30)
                            Text("1 hour").tag(60)
                            Text("Rest of the day").tag(0)
                        } label: { Text("Then open for").textStyle(.control, color: .text) }
                        .tint(Color.mutedText)
                        .cardRow()
                    }
                }
                .disabled(locked)

                Section {
                    Button("Delete protocol", role: .destructive) { confirmDelete = true }
                        .font(.geist(.control))
                        .cardRow()
                }
                .disabled(locked)
            }
            .listStyle(.insetGrouped)
            .pageBackground()
            .navigationTitle(p.name.isEmpty ? "Protocol" : p.name)
            .navigationBarTitleDisplayMode(.inline)
            .familyActivityPicker(isPresented: $pickingApps, selection: bind(\.apps))
            .sheet(isPresented: $pickingTasks) { ScreenTimeTaskPicker(protocolId: id) }
            .confirmationDialog("Delete this protocol?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    model.delete(id)
                    dismiss()
                }
            }
        }
    }

    /// The cooldown's own button: start the wait, give it up, or lock again early.
    @ViewBuilder
    private func cooldownButton(_ p: BlockProtocol) -> some View {
        if p.strictness == .cooldown {
            switch model.state(p) {
            case .blocked:
                action("Unlock in \(p.cooldownMinutes) min") { model.startCooldown(id) }
            case .cooling:
                action("Cancel unlock") { model.endCooldown(id) }
            case .open:
                action("Lock again") { model.endCooldown(id) }
            default:
                EmptyView()
            }
        }
    }

    private func action(_ title: String, _ run: @escaping () -> Void) -> some View {
        Button(action: run) { Text(title).textStyle(.control, medium: true, color: .ink) }
            .cardRow()
    }

    /// A two-way link to one field of this protocol. Writes are dropped while it is locked.
    private func bind<T>(_ key: WritableKeyPath<BlockProtocol, T>) -> Binding<T> {
        Binding(
            get: { (model.find(id) ?? BlockProtocol())[keyPath: key] },
            set: { value in model.update(id) { $0[keyPath: key] = value } }
        )
    }

    private func appsLabel(_ p: BlockProtocol) -> String {
        func count(_ n: Int, _ one: String, _ many: String) -> String? { n == 0 ? nil : n == 1 ? "1 \(one)" : "\(n) \(many)" }
        let parts = [
            count(p.apps.applicationTokens.count, "app", "apps"),
            count(p.apps.categoryTokens.count, "category", "categories"),
            count(p.apps.webDomainTokens.count, "website", "websites"),
        ].compactMap { $0 }
        return parts.isEmpty ? "None" : parts.joined(separator: ", ")
    }

    private func focusLabel(_ p: BlockProtocol) -> String {
        p.focusMinutes == 0 ? "Off" : "\(model.focusMinutesToday) of \(p.focusMinutes) min today"
    }

    private func row(_ title: String, _ value: String, chevron: Bool = false) -> some View {
        HStack(spacing: Space.s) {
            Text(title).textStyle(.control, color: .text)
            Spacer(minLength: Space.m)
            Text(value).textStyle(.control, color: .mutedText).monospacedDigit().lineLimit(1)
            if chevron {
                Image(systemName: "chevron.right").font(.icon(.meta)).foregroundStyle(Color.disabled)
            }
        }
    }
}

/// Open tasks to add to a protocol.
struct ScreenTimeTaskPicker: View {
    var protocolId: String
    @State private var model = ScreenTime.shared
    @State private var store = TaskStore.shared
    @State private var chosen: Set<String> = []
    @Environment(\.dismiss) private var dismiss

    private var open: [LukeTask] {
        let taken = model.find(protocolId)?.taskIds ?? []
        return store.tasks.filter { $0.status != .done && !taken.contains($0.id) }.sorted(by: TaskStore.standardOrder)
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
                        model.add(open.filter { chosen.contains($0.id) }, to: protocolId)
                        dismiss()
                    }
                    .disabled(chosen.isEmpty)
                }
            }
            .task { await store.load() }
        }
    }
}
