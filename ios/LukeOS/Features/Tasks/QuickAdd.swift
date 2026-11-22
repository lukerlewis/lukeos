import SwiftUI

/// "Add to Morning": type a task and press return. Dates and repeats typed into the name
/// ("call mum tomorrow every week") are picked out and shown as chips that can be turned back into words.
struct QuickAddRow: View {
    var placeholder: String
    var base: Input
    @State private var text = ""
    @State private var ignored: Set<String> = []
    @FocusState private var focused: Bool

    private var entry: SmartEntry { SmartEntry.parse(text, today: AppModel.shared.today, ignore: ignored) }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            HStack(spacing: Space.m) {
                Image(systemName: "plus")
                    .font(.icon(.row))
                    .foregroundStyle(Color.icon)
                    .frame(width: Size.tickColumn)
                TextField(placeholder, text: $text)
                    .font(.geist(.control))
                    .foregroundStyle(Color.text)
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(add)
            }
            if focused, !entry.matches.isEmpty {
                SmartChips(entry: entry) { ignored.insert($0.lowercased()) }
                    .padding(.leading, Size.tickColumn + Space.row)
            }
        }
        .frame(minHeight: Size.tap)
        .animation(.snappy, value: entry.matches.count)
    }

    private func add() {
        let e = entry
        guard !e.title.isEmpty else { return }
        var input = base
        input["title"] = .string(e.title)
        if let due = e.dueDate { input["dueDate"] = .string(due) }
        else if e.repeat != nil { input["dueDate"] = .string(AppModel.shared.today) }
        if let r = e.repeat { input["repeat"] = .string(r) }
        if let b = e.bucket { input["bucket"] = .string(b.rawValue) }
        else if e.dueDate != nil { input.removeValue(forKey: "bucket") }
        text = ""
        ignored = []
        focused = true
        Haptics.tap()
        Task { await TaskStore.shared.create(input) }
    }
}

/// The date, repeat and list picked out of a task name, each with an × to keep the words as words.
struct SmartChips: View {
    var entry: SmartEntry
    var onIgnore: (String) -> Void

    var body: some View {
        FlowRow(spacing: Space.line) {
            ForEach(entry.matches, id: \.text) { m in
                Button {
                    onIgnore(m.text)
                } label: {
                    HStack(spacing: Space.xs) {
                        Image(systemName: m.kind == .repeat ? "repeat" : m.kind == .list ? "tray" : "calendar")
                            .font(.icon(.meta))
                        Text(label(m))
                        Image(systemName: "xmark").font(.icon(.meta, weight: .medium)).foregroundStyle(Color.mutedText)
                    }
                    .font(.geist(.tag, medium: true))
                    .foregroundStyle(Color.subtleText)
                    .padding(.horizontal, Space.s)
                    .frame(minHeight: Space.chip + 2)
                    .background(Color.raised, in: .rect(cornerRadius: Radius.tag))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func label(_ m: SmartEntry.Match) -> String {
        switch m.kind {
        case .date: entry.dueDate.map { Day.friendly($0, today: AppModel.shared.today) } ?? m.text
        case .repeat: entry.repeat.map(Repeats.name) ?? m.text
        case .list: entry.bucket?.label ?? m.text
        }
    }
}

/// Which statuses the dashboard shows, and how it's sorted. Shared with every device.
struct FiltersMenu: View {
    @State private var store = TaskStore.shared

    private let sortKeys: [(String, String)] = [("priority", "Priority"), ("effort", "Focus type"), ("project", "Project"), ("name", "Name"), ("created", "Date added")]

    var body: some View {
        Menu {
            Section("Show") {
                ForEach(TaskStatus.allCases, id: \.self) { s in
                    Toggle(s.label, isOn: Binding(
                        get: { store.view.show.contains(s) },
                        set: { on in
                            var show = store.view.show.filter { $0 != s }
                            if on { show.append(s) }
                            guard !show.isEmpty else { return }
                            store.view.show = TaskStatus.allCases.filter(show.contains)
                            Task {
                                await Repo.change("set_dashboard_view", ["show": .array(store.view.show.map { .string($0.rawValue) })])
                                await store.refresh()
                            }
                        }
                    ))
                }
            }
            Section("Sort by") {
                ForEach(sortKeys, id: \.0) { key, label in
                    let rule = store.view.sort.first { $0.by == key }
                    Menu {
                        Button { setSort(key, nil) } label: { if rule == nil { Label("Off", systemImage: "checkmark") } else { Text("Off") } }
                        ForEach(["desc", "asc"], id: \.self) { dir in
                            Button { setSort(key, dir) } label: {
                                if rule?.dir == dir { Label(dirLabel(key, dir), systemImage: "checkmark") } else { Text(dirLabel(key, dir)) }
                            }
                        }
                    } label: {
                        if let rule {
                            Label(label, systemImage: rule.dir == "desc" ? "arrow.down" : "arrow.up")
                        } else {
                            Text(label)
                        }
                    }
                }
            }
        } label: {
            Image(systemName: "line.3.horizontal.decrease")
        }
        .accessibilityLabel("Filters")
    }

    private func dirLabel(_ key: String, _ dir: String) -> String {
        switch key {
        case "priority": dir == "desc" ? "High to low" : "Low to high"
        case "effort": dir == "desc" ? "Deep work first" : "Shallow first"
        case "created": dir == "desc" ? "Newest first" : "Oldest first"
        default: dir == "desc" ? "Z to A" : "A to Z"
        }
    }

    private func setSort(_ key: String, _ dir: String?) {
        var sort = store.view.sort.filter { $0.by != key }
        if let dir {
            if let i = store.view.sort.firstIndex(where: { $0.by == key }) { sort.insert(SortRule(by: key, dir: dir), at: min(i, sort.count)) }
            else { sort.append(SortRule(by: key, dir: dir)) }
        }
        withAnimation(.snappy) { store.view.sort = sort }
        Task {
            await Repo.change("set_dashboard_view", ["sort": .array(sort.map { .object(["by": .string($0.by), "dir": .string($0.dir)]) })])
        }
    }
}
