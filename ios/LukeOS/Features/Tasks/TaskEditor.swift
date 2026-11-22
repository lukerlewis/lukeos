import SwiftUI

/// A task in a sheet. Every change saves as it's made.
struct TaskEditor: View {
    var taskId: String
    var fallback: LukeTask
    @Environment(\.dismiss) private var dismiss
    @State private var store = TaskStore.shared
    @State private var loaded: LukeTask?
    @State private var title = ""
    @State private var notes = ""
    @State private var showDate = false
    @State private var confirmDelete = false
    @State private var notesTask: Task<Void, Never>?

    private var task: LukeTask { store.task(taskId) ?? loaded ?? fallback }
    private var today: String { AppModel.shared.today }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Task name", text: $title, axis: .vertical)
                        .font(.geist(.heading, medium: true))
                        .tracking(LukeType.heading.tracking)
                        .foregroundStyle(Color.ink)
                        .padding(.vertical, Space.xs)
                        .onSubmit(saveTitle)
                        .submitLabel(.done)
                        .onChange(of: title) { _, new in
                            if new.contains("\n") { title = new.replacingOccurrences(of: "\n", with: ""); saveTitle() }
                        }
                    if task.madeBy.isClaude {
                        Label("Added by \(task.madeBy.name ?? "Claude")\(task.madeBy.routine.map { " (\($0))" } ?? "")", systemImage: "sparkle")
                            .textStyle(.meta, color: .mutedText)
                    }
                }

                // The two things changed most, as switches; everything else as menus in one compact list.
                Section {
                    segmented(TaskStatus.allCases, task.status, \.label) { set(["status": .string($0.rawValue)]) }
                    segmented(Bucket.allCases, task.bucket, \.label) { set(["bucket": .string($0.rawValue)]) }
                }
                Section { dueControls }
                Section {
                    menuRow("Repeat", "repeat", Binding(get: { task.repeat ?? "" }, set: { set(["repeat": $0.isEmpty ? .null : .string($0)]) })) {
                        Text("Never").tag("")
                        ForEach(Repeats.named, id: \.0) { Text($0.1).tag($0.0) }
                        Divider()
                        ForEach(Self.gaps, id: \.self) { Text(Repeats.name($0)).tag($0) }
                        if let r = task.repeat, !Repeats.named.contains(where: { $0.0 == r }), !Self.gaps.contains(r) {
                            Text(Repeats.name(r)).tag(r)
                        }
                    }
                    menuRow("Priority", "flame", Binding(get: { task.priority?.rawValue ?? "" }, set: { set(["priority": $0.isEmpty ? .null : .string($0)]) })) {
                        Text("None").tag("")
                        ForEach(Priority.allCases.reversed(), id: \.self) { Text($0.label).tag($0.rawValue) }
                    }
                    if task.area == .work {
                        menuRow("Focus type", "scope", Binding(get: { task.effort?.rawValue ?? "" }, set: { set(["effort": $0.isEmpty ? .null : .string($0)]) })) {
                            Text("None").tag("")
                            ForEach(Effort.allCases, id: \.self) { Text($0.label).tag($0.rawValue) }
                        }
                        menuRow("Signal or noise", "dot.radiowaves.left.and.right", Binding(get: { task.lane.rawValue }, set: { set(["lane": .string($0)]) })) {
                            ForEach(Lane.allCases, id: \.self) { Text($0.label).tag($0.rawValue) }
                        }
                        menuRow("Project", "circle.grid.2x1", Binding(get: { task.project?.id ?? "" }, set: { set(["projectId": $0.isEmpty ? .null : .string($0)]) })) {
                            Text("None").tag("")
                            ForEach(store.projects(in: .work)) { p in Text(p.name).tag(p.id) }
                        }
                    } else {
                        menuRow("Time of day", "sun.max", Binding(get: { task.timeOfDay.rawValue }, set: { set(["timeOfDay": .string($0)]) })) {
                            ForEach(TimeOfDay.allCases, id: \.self) { Text($0.label).tag($0.rawValue) }
                        }
                    }
                    menuRow("Area", "square.split.2x1", Binding(get: { task.area.rawValue }, set: { set(["area": .string($0)]) })) {
                        ForEach(Area.allCases, id: \.self) { Text($0.label).tag($0.rawValue) }
                    }
                }

                Section("Notes") {
                    TextField("Details, links or a checklist", text: $notes, axis: .vertical)
                        .font(.geist(.body))
                        .lineLimit(4...)
                        .onChange(of: notes) { _, new in scheduleNotes(new) }
                }

                Section("Comments") {
                    CommentThreads(targetType: "task", targetId: taskId)
                        .padding(.vertical, Space.line)
                }

                Section {
                    Button("Delete task", role: .destructive) { confirmDelete = true }
                        .font(.geist(.control))
                        .frame(maxWidth: .infinity)
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Color.page)
            .listSectionSpacing(Space.xxl)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm) { close() }
                }
            }
            .confirmationDialog("Delete this task?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Move to Trash", role: .destructive) {
                    store.delete(task)
                    dismiss()
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onAppear {
            title = task.title
            notes = task.notes ?? ""
        }
        .task {
            if let fresh = try? await Repo.fetch("get_task", ["id": .string(taskId)], as: LukeTask.self) {
                loaded = fresh
                if title.isEmpty || title == fallback.title { title = fresh.title }
                if notes.isEmpty { notes = fresh.notes ?? "" }
            }
        }
        .onDisappear(perform: flush)
    }

    // MARK: Pieces

    static let gaps = ["every_2_days", "every_3_days", "every_2_weeks", "every_3_weeks", "every_3_months", "every_6_months"]

    /// A settings-style row: icon, name, and the choice on the right as a menu.
    private func menuRow<C: View>(_ title: String, _ symbol: String, _ selection: Binding<String>, @ViewBuilder options: () -> C) -> some View {
        Picker(selection: Binding(get: { selection.wrappedValue }, set: { Haptics.select(); selection.wrappedValue = $0 })) {
            options()
        } label: {
            Label {
                Text(title).textStyle(.control, color: .text)
            } icon: {
                Image(systemName: symbol).font(.icon(.row)).foregroundStyle(Color.icon)
            }
        }
        .pickerStyle(.menu)
        .tint(.mutedText)
        .frame(minHeight: Size.tap)
    }

    private func segmented<T: Hashable>(_ options: [T], _ value: T, _ label: @escaping (T) -> String, onPick: @escaping (T) -> Void) -> some View {
        Picker("", selection: Binding(get: { value }, set: { Haptics.select(); onPick($0) })) {
            ForEach(options, id: \.self) { Text(label($0)).tag($0) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .listRowInsets(EdgeInsets(top: Space.m, leading: Space.m, bottom: Space.m, trailing: Space.m))
    }

    private var dueControls: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            HStack(spacing: Space.m) {
                Image(systemName: "calendar").font(.icon(.row)).foregroundStyle(Color.icon)
                if let due = task.dueDate {
                    Text(Day.friendly(due, today: today)).textStyle(.control, medium: due < today, color: due < today ? .ink : .text)
                } else {
                    Text("No date").textStyle(.control, color: .mutedText)
                }
                Spacer()
                DatePicker("", selection: Binding(
                    get: { Day.toLocal(task.dueDate ?? today) },
                    set: { set(["dueDate": .string(Day.fromLocal($0))]) }
                ), displayedComponents: .date)
                .labelsHidden()
            }
            ScrollView(.horizontal) {
                HStack(spacing: Space.s) {
                    quick("Today", today)
                    quick("Tomorrow", Day.add(today, days: 1))
                    quick("This weekend", Day.endOfWeek(today) == today ? today : Day.add(Day.endOfWeek(today), days: -1))
                    quick("Next week", Day.add(Day.endOfWeek(today), days: 1))
                    Button("No date") { set(["dueDate": .null]) }
                        .buttonStyle(.bordered)
                        .disabled(task.dueDate == nil)
                }
                .font(.geist(.preview, medium: true))
            }
            .scrollIndicators(.hidden)
        }
        .padding(.vertical, Space.xs)
    }

    private func quick(_ label: String, _ day: String) -> some View {
        Button(label) { set(["dueDate": .string(day)]) }
            .buttonStyle(.bordered)
            .tint(task.dueDate == day ? .ink : .subtleText)
    }

    // MARK: Saving

    private func set(_ changes: Input) {
        store.update(taskId, changes)
        if store.task(taskId) == nil, var l = loaded {
            // Not on the dashboard (opened from a link or another list): keep the sheet in step.
            for (k, v) in changes {
                if k == "status", let s = v.stringValue.flatMap(TaskStatus.init) { l.status = s }
                if k == "bucket", let b = v.stringValue.flatMap(Bucket.init) { l.bucket = b }
                if k == "dueDate" { l.dueDate = v.stringValue }
                if k == "priority" { l.priority = v.stringValue.flatMap(Priority.init) }
                if k == "repeat" { l.repeat = v.stringValue }
            }
            loaded = l
        }
    }

    private func saveTitle() {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, t != task.title else { return }
        set(["title": .string(t)])
    }

    private func scheduleNotes(_ text: String) {
        notesTask?.cancel()
        notesTask = Task {
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            if text != (task.notes ?? "") { set(["notes": text.isEmpty ? .null : .string(text)]) }
        }
    }

    private func flush() {
        saveTitle()
        notesTask?.cancel()
        if notes != (task.notes ?? "") { set(["notes": notes.isEmpty ? .null : .string(notes)]) }
    }

    private func close() {
        flush()
        dismiss()
    }
}

/// A new task: a name (with dates and repeats picked out as you type) and where it goes.
struct NewTaskSheet: View {
    var area: Area
    var base: Input = [:]
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var ignored: Set<String> = []
    @State private var bucket: Bucket = .today
    @State private var slot = ""
    @State private var projectId = ""
    @FocusState private var focused: Bool
    @State private var store = TaskStore.shared

    private var entry: SmartEntry { SmartEntry.parse(text, today: AppModel.shared.today, ignore: ignored) }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Space.l) {
                TextField("New task", text: $text, axis: .vertical)
                    .font(.geist(.section, medium: true))
                    .tracking(-0.88)
                    .foregroundStyle(Color.ink)
                    .focused($focused)
                    .submitLabel(.done)
                    .onChange(of: text) { _, new in if new.contains("\n") { text = new.replacingOccurrences(of: "\n", with: ""); add() } }
                if !entry.matches.isEmpty {
                    SmartChips(entry: entry) { ignored.insert($0.lowercased()) }
                }
                Picker("List", selection: $bucket) {
                    ForEach(Bucket.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                if area == .life {
                    Picker("Time of day", selection: $slot) {
                        ForEach(TimeOfDay.allCases, id: \.self) { Text($0.label).tag($0.rawValue) }
                    }
                    .pickerStyle(.segmented)
                } else {
                    Picker("Lane", selection: $slot) {
                        ForEach(Lane.allCases, id: \.self) { Text($0.label).tag($0.rawValue) }
                    }
                    .pickerStyle(.segmented)
                    Picker("Project", selection: $projectId) {
                        Text("No project").tag("")
                        ForEach(store.projects(in: .work)) { Text($0.name).tag($0.id) }
                    }
                    .font(.geist(.control))
                    .tint(.subtleText)
                }
                Spacer(minLength: 0)
            }
            .padding(Space.xl)
            .background(Color.page)
            .navigationTitle("New task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .cancel) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", systemImage: "arrow.up", role: .confirm, action: add)
                        .disabled(entry.title.isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear {
            focused = true
            slot = area == .life ? "day" : "noise"
        }
    }

    private func add() {
        let e = entry
        guard !e.title.isEmpty else { return }
        var input = base
        input["title"] = .string(e.title)
        input["area"] = .string(area.rawValue)
        input[area == .life ? "timeOfDay" : "lane"] = .string(slot)
        if !projectId.isEmpty { input["projectId"] = .string(projectId) }
        if let due = e.dueDate { input["dueDate"] = .string(due) } else if e.repeat != nil { input["dueDate"] = .string(AppModel.shared.today) }
        if let r = e.repeat { input["repeat"] = .string(r) }
        let pickedBucket = e.bucket ?? (e.dueDate != nil && bucket == .today ? nil : bucket)
        if let pickedBucket { input["bucket"] = .string(pickedBucket.rawValue) }
        Haptics.tap()
        Task { await store.create(input) }
        dismiss()
    }
}
