import SwiftUI

/// The home screen: the date and a greeting, Work | Life and Today | Board,
/// then Today's cards (Life: Morning, Day, Evening; Work: Signal, Noise) or the board.
struct DashboardScreen: View {
    @Environment(AppModel.self) private var app
    @State private var store = TaskStore.shared
    @State private var home = Home.shared
    @State private var editing: LukeTask?
    @State private var adding = false
    @AppStorage("dashboardLayout", store: SharedConfig.defaults) private var layout = "list"

    var body: some View {
        @Bindable var app = app
        NavigationStack {
            Group {
                if layout == "board" {
                    ScrollView {
                        header
                        BoardView(tasks: areaTasks, onOpen: { editing = $0 })
                    }
                } else {
                    todayList
                }
            }
            .pageBackground()
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { FiltersMenu() }
            }
            .navigationTitle(greeting)
            .navigationSubtitle(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()))
            .toolbarTitleDisplayMode(.large)
            .refreshable { await reload() }
            .overlay(alignment: .bottomTrailing) { addButton }
            .sheet(item: $editing) { task in
                TaskEditor(taskId: task.id, fallback: task)
            }
            .sheet(isPresented: $adding) {
                NewTaskSheet(area: app.area)
            }
            .task { await reload() }
            .onChange(of: app.pendingLink) { _, _ in openLink() }
            .onAppear(perform: openLink)
            .onReceive(NotificationCenter.default.publisher(for: .lukeOSSynced)) { _ in
                Task { await store.refresh() }
            }
        }
    }

    private func reload() async {
        async let a: () = store.load()
        async let b: () = home.refresh()
        _ = await (a, b)
    }

    private func openLink() {
        guard let link = app.take("/?") else { return }
        if link.contains("new=task") { adding = true; return }
        if let id = link.components(separatedBy: "task=").last?.components(separatedBy: "&").first {
            editing = store.task(id) ?? LukeTask(id: id, title: "")
        }
    }

    private var areaTasks: [LukeTask] { store.tasks.filter { $0.area == app.area && store.shows($0) } }
    private var todays: [LukeTask] { areaTasks.filter { $0.bucket == .today } }

    // MARK: Header

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: .now)
        return h < 12 ? "Good morning, Luke" : h < 18 ? "Good afternoon, Luke" : "Good evening, Luke"
    }

    private var header: some View {
        @Bindable var app = app
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Picker("Area", selection: $app.area.animation(.snappy)) {
                    ForEach(Area.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(width: 140)
                Picker("Layout", selection: $layout.animation(.snappy)) {
                    Label("Today", systemImage: "list.bullet").tag("list")
                    Label("Board", systemImage: "square.split.2x1").tag("board")
                }
                .pickerStyle(.segmented)
            }
            .onChange(of: layout) { _, new in
                Task { await Repo.change("set_dashboard_view", ["layout": .string(new)]) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.top, 4)
        .padding(.bottom, 6)
    }

    // MARK: Today

    private var todayList: some View {
        List {
            header
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)

            if !store.loaded && store.tasks.isEmpty {
                ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
            } else if let error = store.error, store.tasks.isEmpty {
                EmptyNote(text: error, symbol: "wifi.slash").listRowBackground(Color.clear)
            } else if app.area == .life {
                ForEach(TimeOfDay.allCases, id: \.self) { time in
                    TaskCardSection(
                        title: time.label, symbol: time.symbol,
                        tasks: store.sorted(todays.filter { $0.timeOfDay == time }),
                        newTask: ["timeOfDay": .string(time.rawValue), "area": "life", "bucket": "today"],
                        dropChange: { ["timeOfDay": .string(time.rawValue)] },
                        onOpen: { editing = $0 }
                    )
                }
            } else {
                ForEach(Lane.allCases, id: \.self) { lane in
                    TaskCardSection(
                        title: lane.label, symbol: lane.symbol,
                        tasks: store.sorted(todays.filter { $0.lane == lane }),
                        newTask: ["lane": .string(lane.rawValue), "area": "work", "bucket": "today"],
                        dropChange: { ["lane": .string(lane.rawValue)] },
                        onOpen: { editing = $0 }
                    )
                }
            }

            if let pad = home.data?.scratchPad {
                Section {
                    ScratchPadEditor(noteId: pad.id, initial: pad.content)
                        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 10, trailing: 16))
                } header: {
                    Text("Scratch pad").textStyle(.heading, medium: true, color: .ink).textCase(nil)
                        .padding(.leading, -4)
                }
                .listRowBackground(Color.card)
            }

            Color.clear.frame(height: 60).listRowBackground(Color.clear)
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(18)
        .environment(\.defaultMinListRowHeight, 44)
        .contentMargins(.top, 0, for: .scrollContent)
    }

    private var addButton: some View {
        Button {
            adding = true
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 22, weight: .regular))
                .foregroundStyle(Color.ink)
                .frame(width: 56, height: 56)
        }
        .glassEffect(.regular.interactive(), in: .circle)
        .padding(.trailing, 20)
        .padding(.bottom, 16)
        .accessibilityLabel("New task")
    }
}

/// One Today card as a list section: its icon, name and count, its tasks, and an "Add to …" row.
struct TaskCardSection: View {
    var title: String
    var symbol: String
    var tasks: [LukeTask]
    var newTask: Input
    var dropChange: () -> Input
    var onOpen: (LukeTask) -> Void
    @State private var store = TaskStore.shared

    var body: some View {
        Section {
            ForEach(tasks) { task in
                TaskRow(task: task, onOpen: { onOpen(task) })
                    .taskRowActions(task, onOpen: { onOpen(task) })
                    .draggable(task.id)
            }
            .dropDestination(for: String.self) { ids, _ in
                for id in ids { store.update(id, dropChange()) }
            }
            QuickAddRow(placeholder: "Add to \(title)", base: newTask)
        } header: {
            HStack(spacing: 8) {
                Image(systemName: symbol).font(.system(size: 14)).foregroundStyle(Color.icon)
                Text(title).textStyle(.heading, medium: true, color: .ink)
                Text("\(tasks.count)").textStyle(.meta, color: .mutedText).monospacedDigit()
            }
            .textCase(nil)
            .padding(.leading, -4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
            .dropDestination(for: String.self) { ids, _ in
                for id in ids { store.update(id, dropChange()) }
                return true
            }
        }
        .listRowBackground(Color.card)
        .listRowSeparatorTint(Color.hairline)
    }
}

extension View {
    /// Swipe right to tick; swipe left to move or delete; press and hold for everything.
    func taskRowActions(_ task: LukeTask, onOpen: @escaping () -> Void) -> some View {
        let store = TaskStore.shared
        return self
            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                Button {
                    store.toggle(task)
                } label: {
                    Label(task.status == .done ? "Not done" : "Done", systemImage: task.status == .done ? "circle" : "checkmark")
                }
                .tint(Color.swipePrimary)
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button(role: .destructive) { store.delete(task) } label: { Label("Delete", systemImage: "trash") }
                Menu {
                    ForEach(Bucket.allCases, id: \.self) { b in
                        Button(b.label) { store.update(task.id, ["bucket": .string(b.rawValue)], undoLabel: "Moved to \(b.label)") }
                            .disabled(task.bucket == b)
                    }
                } label: {
                    Label("Move", systemImage: "tray.and.arrow.down")
                }
                .tint(Color.swipeSecondary)
            }
            .contextMenu { TaskMenu(task: task, onOpen: onOpen) }
    }
}
