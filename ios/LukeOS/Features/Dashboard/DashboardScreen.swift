import SwiftUI

/// The home screen, titled Today with the date under it. Work | Life sits in the top bar and
/// Today | Board in the filter menu, so the first screen is the tasks themselves.
/// Today's cards: Life has Morning, Day, Evening; Work has Signal, Noise.
struct DashboardScreen: View {
    @Environment(AppModel.self) private var app
    @State private var store = TaskStore.shared
    @State private var home = Home.shared
    @State private var editing: LukeTask?
    @State private var adding = false
    @AppStorage("dashboardLayout", store: SharedConfig.defaults) private var layout = "list"
    @Namespace private var zoom

    var body: some View {
        @Bindable var app = app
        NavigationStack {
            Group {
                if layout == "board" {
                    ScrollView {
                        dateLine.padding(.horizontal, Space.page)
                        BoardView(tasks: areaTasks, onOpen: { editing = $0 })
                            .padding(.top, Space.s)
                    }
                } else {
                    todayList
                }
            }
            .pageBackground()
            .toolbar {
                ToolbarItem(placement: .principal) { areaPicker.frame(width: Size.areaSwitch) }
                ToolbarItem(placement: .topBarTrailing) { FiltersMenu(layout: $layout) }
            }
            .navigationTitle(layout == "board" ? "Board" : "Today")
            .toolbarTitleDisplayMode(.large)
            .onChange(of: layout) { _, new in
                Task { await Repo.change("set_dashboard_view", ["layout": .string(new)]) }
            }
            .refreshable { await reload() }
            .overlay(alignment: .bottomTrailing) { addButton }
            .sheet(item: $editing) { task in
                TaskEditor(taskId: task.id, fallback: task)
                    .zoomTransition(task.id, in: zoom)
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

    private var areaPicker: some View {
        @Bindable var app = app
        return Picker("Area", selection: $app.area.animation(Motion.snappy)) {
            ForEach(Area.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
    }

    /// The date, quietly, under the large title.
    private var dateLine: some View {
        Text(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()))
            .textStyle(.control, color: .mutedText)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Today

    private var todayList: some View {
        List {
            // The date as the first section's header: close under the title, one section gap above the first card.
            Section {} header: {
                dateLine.textCase(nil).padding(.leading, -Space.xl).padding(.top, -Space.l)
            }
            .listSectionSpacing(Space.l)
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
                        zoom: zoom,
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
                        zoom: zoom,
                        onOpen: { editing = $0 }
                    )
                }
            }

            if let pad = home.data?.scratchPad {
                Section {
                    ScratchPadEditor(noteId: pad.id, initial: pad.content)
                        .listRowInsets(EdgeInsets(top: 6, leading: Space.inset, bottom: 14, trailing: Space.inset))
                } header: {
                    Text("Scratch pad").textStyle(.heading, medium: true, color: .ink).textCase(nil)
                        .padding(.leading, -4)
                }
                .listRowBackground(Color.card)
            }

            Color.clear.frame(height: Size.fab).listRowBackground(Color.clear)
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(Space.section)
        .contentMargins(.top, 0, for: .scrollContent)
    }

    private var addButton: some View {
        Button {
            adding = true
        } label: {
            Image(systemName: "plus")
                .font(.icon(.transport, weight: .regular))
                .foregroundStyle(Color.ink)
                .frame(width: Size.fab, height: Size.fab)
        }
        .glassEffect(.regular.interactive(), in: .circle)
        .padding(.trailing, Space.xl)
        .padding(.bottom, Space.l)
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
    var zoom: Namespace.ID? = nil
    var onOpen: (LukeTask) -> Void
    @State private var store = TaskStore.shared
    /// How many of this card's parts a dragged task is over (rows, the add row, the header).
    @State private var over = 0

    private var targeted: Bool { over > 0 }

    /// Any part of the card takes a dropped task; the whole card lights up while one is over it.
    private func dropTarget<V: View>(_ v: V) -> some View {
        v.dropDestination(for: String.self) { ids, _ in
            for id in ids { store.update(id, dropChange()) }
            return true
        } isTargeted: { on in
            let was = targeted
            over = max(0, over + (on ? 1 : -1))
            if !was && targeted { Haptics.select() }
        }
    }

    var body: some View {
        Section {
            ForEach(tasks) { task in
                dropTarget(
                    TaskRow(task: task, onOpen: { onOpen(task) })
                        .draggable(task.id)
                )
                .taskRowInsets()
                .taskRowActions(task, onOpen: { onOpen(task) })
            }
            dropTarget(QuickAddRow(placeholder: "Add to \(title)", base: newTask))
        } header: {
            HStack(spacing: Space.s) {
                Image(systemName: symbol).font(.icon(.row)).foregroundStyle(Color.icon)
                Text(title).textStyle(.heading, medium: true, color: .ink)
                Text("\(tasks.count)").textStyle(.preview, color: .mutedText).rollingNumber(tasks.count)
            }
            .textCase(nil)
            .padding(.leading, -4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
            .modifier(DropTargetModifier(apply: dropTarget))
        }
        .listRowBackground(targeted ? Color.muted : Color.card)
        .animation(Motion.snappy, value: targeted)
        .listRowSeparatorTint(Color.hairline)
    }
}

/// Lets a header use the same drop handling as the rows.
private struct DropTargetModifier<Out: View>: ViewModifier {
    var apply: (AnyView) -> Out
    func body(content: Content) -> some View { apply(AnyView(content)) }
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
