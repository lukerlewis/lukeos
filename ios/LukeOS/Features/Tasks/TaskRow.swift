import SwiftUI

/// One task: the round tick, its name, and a quiet meta line.
struct TaskRow: View {
    var task: LukeTask
    var showProject = true
    var onOpen: () -> Void = {}
    @State private var store = TaskStore.shared

    private var today: String { AppModel.shared.today }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button {
                store.toggle(task)
            } label: {
                StatusCircle(status: task.status)
                    .padding(.top, 1)
                    .frame(width: 30, height: 30, alignment: .topLeading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(task.status == .done ? "Mark not done" : "Mark done")

            VStack(alignment: .leading, spacing: 6) {
                Text(task.title)
                    .textStyle(.control, color: task.status == .done ? .mutedText : .text)
                    .strikethrough(task.status == .done, color: .mutedText)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                if hasMeta { meta }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 3)
        }
        .padding(.vertical, 2)
        .contentShape(.rect)
        .onTapGesture(perform: onOpen)
    }

    private var hasMeta: Bool {
        (showProject && task.project != nil) || task.priority != nil || (task.area == .work && task.effort != nil)
            || task.dueDate != nil || task.repeat != nil || (task.notes?.isEmpty == false) || task.madeBy.isClaude
    }

    private var meta: some View {
        FlowRow(spacing: 6) {
            if showProject, let p = task.project { ProjectChip(name: p.name, color: p.color) }
            if let p = task.priority { PriorityChip(priority: p) }
            if task.area == .work, let e = task.effort { FocusChip(effort: e) }
            if let due = task.dueDate { DueLabel(due: due, today: today).frame(height: 22) }
            if let r = task.repeat {
                Image(systemName: "repeat").font(.system(size: 11)).foregroundStyle(Color.mutedText)
                    .frame(height: 22).accessibilityLabel(Repeats.name(r))
            }
            if task.notes?.isEmpty == false {
                Image(systemName: "text.alignleft").font(.system(size: 11)).foregroundStyle(Color.mutedText).frame(height: 22)
            }
            ClaudeMark(madeBy: task.madeBy).frame(height: 22)
        }
    }
}

/// Lays chips out in rows, wrapping when they run out of room.
struct FlowRow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: min(maxX, width), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// Long-press menu shared by every task row.
struct TaskMenu: View {
    var task: LukeTask
    var onOpen: () -> Void
    @State private var store = TaskStore.shared

    var body: some View {
        Button("Open", systemImage: "arrow.up.right.square", action: onOpen)
        Picker(selection: Binding(get: { task.status }, set: { store.setStatus(task, $0) })) {
            ForEach(TaskStatus.allCases, id: \.self) { s in Text(s.label).tag(s) }
        } label: { Label("Status", systemImage: "circle.lefthalf.filled") }
            .pickerStyle(.menu)
        Picker(selection: Binding(get: { task.bucket }, set: { store.update(task.id, ["bucket": .string($0.rawValue)]) })) {
            ForEach(Bucket.allCases, id: \.self) { b in Text(b.label).tag(b) }
        } label: { Label("List", systemImage: "tray") }
            .pickerStyle(.menu)
        if task.area == .life {
            Picker(selection: Binding(get: { task.timeOfDay }, set: { store.update(task.id, ["timeOfDay": .string($0.rawValue)]) })) {
                ForEach(TimeOfDay.allCases, id: \.self) { t in Label(t.label, systemImage: t.symbol).tag(t) }
            } label: { Label("Time of day", systemImage: "sun.max") }
                .pickerStyle(.menu)
        } else {
            Picker(selection: Binding(get: { task.lane }, set: { store.update(task.id, ["lane": .string($0.rawValue)]) })) {
                ForEach(Lane.allCases, id: \.self) { l in Text(l.label).tag(l) }
            } label: { Label("Signal or noise", systemImage: "dot.radiowaves.left.and.right") }
                .pickerStyle(.menu)
        }
        Picker(selection: Binding(get: { task.priority }, set: { store.update(task.id, ["priority": .optional($0?.rawValue)]) })) {
            Text("None").tag(Priority?.none)
            ForEach(Priority.allCases.reversed(), id: \.self) { p in Text(p.label).tag(Priority?.some(p)) }
        } label: { Label("Priority", systemImage: "flame") }
            .pickerStyle(.menu)
        Divider()
        Button("Delete", systemImage: "trash", role: .destructive) { store.delete(task) }
    }
}
