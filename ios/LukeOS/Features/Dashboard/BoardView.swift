import SwiftUI

/// The board: Today, Tomorrow, This week and Later as columns that page sideways, the next one peeking.
/// Drag a card onto another column to move it there (sets the list, never the date).
struct BoardView: View {
    var tasks: [LukeTask]
    var columns: [(id: String, title: String)] = Bucket.allCases.map { ($0.rawValue, $0.label) }
    var byStatus = false
    var onOpen: (LukeTask) -> Void
    @State private var store = TaskStore.shared
    @State private var target: String?

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(alignment: .top, spacing: 12) {
                ForEach(columns, id: \.id) { column in
                    let here = store.sorted(tasks.filter { (byStatus ? $0.status.rawValue : $0.bucket.rawValue) == column.id })
                    BoardColumnView(
                        title: column.title, tasks: here, highlighted: target == column.id,
                        newTask: byStatus ? ["status": .string(column.id), "area": .string(AppModel.shared.area.rawValue)]
                            : ["bucket": .string(column.id), "area": .string(AppModel.shared.area.rawValue)],
                        onOpen: onOpen
                    )
                    .containerRelativeFrame(.horizontal) { w, _ in w * 0.86 }
                    .dropDestination(for: String.self) { ids, _ in
                        for id in ids {
                            if let t = store.task(id) {
                                let change: Input = byStatus ? ["status": .string(column.id)] : ["bucket": .string(column.id)]
                                if byStatus ? t.status.rawValue != column.id : t.bucket.rawValue != column.id {
                                    Haptics.select()
                                    store.update(id, change)
                                }
                            }
                        }
                        return true
                    } isTargeted: { on in
                        withAnimation(.snappy) { target = on ? column.id : (target == column.id ? nil : target) }
                    }
                }
            }
            .scrollTargetLayout()
            .padding(.horizontal, 20)
            .padding(.bottom, 90)
        }
        .scrollTargetBehavior(.viewAligned)
        .scrollIndicators(.hidden)
    }
}

struct BoardColumnView: View {
    var title: String
    var tasks: [LukeTask]
    var highlighted: Bool
    var newTask: Input
    var onOpen: (LukeTask) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(title).textStyle(.heading, medium: true, color: .ink)
                Text("\(tasks.count)").textStyle(.meta, color: .mutedText).monospacedDigit()
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            Divider().overlay(Color.hairline)
            if tasks.isEmpty {
                Text("Nothing here.").textStyle(.preview, color: .mutedText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
            }
            ForEach(tasks) { task in
                TaskRow(task: task, onOpen: { onOpen(task) })
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                    .background(Color.card)
                    .draggable(task.id) {
                        Text(task.title).textStyle(.control, medium: true, color: .ink)
                            .padding(.horizontal, 16).padding(.vertical, 12)
                            .background(Color.card, in: .rect(cornerRadius: 14))
                    }
                    .contextMenu { TaskMenu(task: task, onOpen: { onOpen(task) }) }
                Divider().overlay(Color.hairline).padding(.leading, 58)
            }
            QuickAddRow(placeholder: "Add a task", base: newTask)
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
        }
        .background(highlighted ? Color.muted : Color.card, in: .rect(cornerRadius: Radius.card))
        .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(highlighted ? Color.strokeStrong : Color.hairline, lineWidth: 1))
        .clipShape(.rect(cornerRadius: Radius.card))
    }
}
