#if DEBUG
import Foundation

/// Debug only (`-demo -recordWrites -exerciseWrites`): runs every change the app can make through the same
/// models and stores the screens use, so the recorded inputs can be checked against the server's rules.
@MainActor
enum WriteExercise {
    static func runIfAsked() async {
        guard ProcessInfo.processInfo.arguments.contains("-exerciseWrites") else { return }
        let store = TaskStore.shared
        await store.load()
        guard let task = store.tasks.first else { return }
        let projectId = store.projects.first?.id ?? "12ac250b-2a67-434d-a1c3-73eaca86549a"

        // Tasks
        let created = await store.create(["title": "Call mum", "area": "life", "bucket": "today", "timeOfDay": "morning",
                                          "dueDate": .string(Day.add(Day.today(), days: 1)), "repeat": "every_2_weeks"])
        _ = await store.create(["title": "Draft hooks", "area": "work", "lane": "signal", "projectId": .string(projectId)])
        store.toggle(task)
        store.setStatus(task, .doing)
        for (k, v) in TaskStore.fields(of: task) { store.update(task.id, [k: v]) }
        store.update(task.id, ["priority": .null, "effort": "deep", "dueDate": .null, "notes": "- [ ] one", "repeat": "weekdays"])
        store.restore(task)
        store.delete(created)
        await Repo.change("restore_from_trash", ["type": "task", "id": .string(created.id)])
        await Repo.change("set_dashboard_view", ["layout": "board"])
        await Repo.change("set_dashboard_view", ["show": ["todo", "doing", "done"]])
        await Repo.change("set_dashboard_view", ["sort": [["by": "priority", "dir": "desc"], ["by": "project", "dir": "asc"]]])

        // Notes and folders
        let notes = NotesModel(folder: nil)
        await notes.load()
        let noteId = await notes.newNote()
        await Repo.change("update_note", ["id": .string(noteId), "title": "Ideas", "content": "# Ideas\n\n- [ ] one"])
        if let n = notes.notes.first {
            notes.setPinned(n, true)
            notes.move(n, to: notes.folders.first)
            notes.setProject(n, store.projects.first)
            notes.delete(n)
        }
        await Repo.change("create_folder", ["name": "Recipes"])
        if let f = notes.folders.first {
            await Repo.change("update_folder", ["id": .string(f.id), "name": "Journal 2026"])
            await Repo.change("update_folder", ["id": .string(f.id), "projectId": .string(projectId)])
            await Repo.change("delete_folder", ["id": .string(f.id)])
        }
        if let pad = Home.shared.data?.scratchPad { await Repo.change("update_note", ["id": .string(pad.id), "content": "Jot"]) }

        // Comments
        await Repo.change("add_comment", ["targetType": "task", "targetId": .string(task.id), "body": "@claude can you help?"])
        await Repo.change("reply_to_comment", ["id": "1b949c36-d270-4fe2-9597-f2bc2dbcbaa2", "body": "Thanks"])
        await Repo.change("resolve_comment", ["id": "1b949c36-d270-4fe2-9597-f2bc2dbcbaa2", "resolved": true])
        await Repo.change("delete_comment", ["id": "67b306b0-b428-4892-8c1b-f426ba54e622"])

        // Focus
        let focus = FocusTimer.shared
        focus.state.mode = .pomodoro
        focus.startPomodoro()
        focus.state.pomodoro.startedAt = Date.now.addingTimeInterval(-600)
        focus.state.pomodoro.endsAt = Date.now.addingTimeInterval(focus.length(.focus) - 600)
        focus.pausePomodoro()
        focus.resetPomodoro()
        focus.startTimer()
        focus.state.timerRunningSince = Date.now.addingTimeInterval(-300)
        focus.stopTimer()
        focus.state.sprintTasks = [SprintTask(id: task.id, title: task.title, done: false)]
        focus.startSprint()
        focus.state.sprint.endsAt = Date.now.addingTimeInterval(60)
        focus.state.sprint.startedAt = Date.now.addingTimeInterval(-1500)
        focus.state.sprint.lengthSeconds = 1560
        focus.finishSprint()
        focus.newSprint()
        await Repo.change("update_scratch_pad", ["text": "Email Dana"])
        await Repo.change("update_focus_settings", ["focusMinutes": 30, "shortBreakMinutes": 5, "longBreakMinutes": 20, "roundsBeforeLongBreak": 4])
        await Repo.change("update_focus_session", ["id": "0b39ba7c-c4fa-42fe-b899-dfea2a0fa8ca", "seconds": 1200])
        await Repo.change("delete_focus_session", ["id": "0b39ba7c-c4fa-42fe-b899-dfea2a0fa8ca"])

        // Music
        let music = MusicModel.shared
        await music.load()
        if let ep = music.podcasts.first, let p = music.playlists.first {
            music.mark(ep, finished: true)
            music.keep(ep)
            music.add(ep, to: p)
            AudioPlayer.shared.play([ep])
            AudioPlayer.shared.pause()
            await Repo.change("remove_from_playlist", ["playlistId": .string(p.id), "episodeIds": [.string(ep.id)]])
            await Repo.change("update_playlist", ["id": .string(p.id), "episodeIds": [.string(ep.id)]])
            await Repo.change("update_playlist", ["id": .string(p.id), "excludeFromShuffle": true])
            music.newPlaylist("Running")
            await Repo.change("delete_playlist", ["id": .string(p.id)])
            music.delete(ep)
            AudioPlayer.shared.stop()
        }

        // Messages
        let chat = MessagesModel()
        await chat.load()
        chat.send(text: "Can you check the invoice?", attachments: [], replyTo: chat.messages.last)
        chat.send(text: "Photo", attachments: [Message.Attachment(id: "7c15cd7b-5aa8-4931-874b-06ccf3afd1e6", kind: "image", name: "Photo.jpg", url: "/api/stored/7c15cd7b-5aa8-4931-874b-06ccf3afd1e6", thumb: "/api/stored/96491bdf-9222-48e5-950d-f55211b6d04a", width: 1200, height: 900)], replyTo: nil)
        if let mine = chat.messages.first(where: { $0.mine && $0.unsent != true }) {
            chat.edit(mine, text: "Edited text")
            chat.unsend(mine)
        }
        Home.shared.data?.unreadMessages = 1
        Home.shared.markRead()

        // Projects, links, documents, inspiration, trash, settings
        await Repo.change("create_project", ["name": "Garden"])
        await Repo.change("update_project", ["id": .string(projectId), "name": "Content 2"])
        await Repo.change("update_project", ["id": .string(projectId), "color": "teal"])
        await Repo.change("add_link", ["projectId": .string(projectId), "url": "https://apple.com"])
        await Repo.change("update_link", ["id": "39ca761e-f81e-4452-bf4d-e61db2b9df69", "pinned": false])
        await Repo.change("delete_link", ["id": "39ca761e-f81e-4452-bf4d-e61db2b9df69"])
        await Repo.change("update_document", ["id": "93e1e741-f28f-4cf3-840e-362a0c87314b", "pinned": false])
        await Repo.change("update_document", ["id": "93e1e741-f28f-4cf3-840e-362a0c87314b", "content": "# Plan\n\n- [x] Done"])
        await Repo.change("mark_from_claude_seen", [:])
        await Repo.change("add_inspiration", ["url": "https://apple.com/design"])
        await Repo.change("add_inspiration", ["text": "Less, but better."])
        await Repo.change("update_inspiration", ["id": "fa3d0929-d7aa-42a6-9660-4ab77e9dec5a", "note": "Love the blur"])
        await Repo.change("delete_inspiration", ["id": "fa3d0929-d7aa-42a6-9660-4ab77e9dec5a"])
        await Repo.change("delete_document", ["id": "93e1e741-f28f-4cf3-840e-362a0c87314b"])
        await Repo.change("delete_forever", ["type": "message", "id": "f9ad0490-68b7-454a-b8fc-436925404586"])
        await Repo.change("empty_trash", [:])
        await Repo.change("delete_project", ["id": .string(projectId)])
        await Repo.change("set_time_zone", ["timeZone": .string(TimeZone.current.identifier)])
        // Widget tick and Siri
        _ = try? await LukeAPI.shared.opData("update_task", ["id": .string(task.id), "status": "done"])
        _ = try? await AddTaskIntent(title: "Pay rent monthly from the 1st").performForCheck()
        try? await Task.sleep(for: .seconds(2))
        print("Write exercise finished")
    }
}

extension AddTaskIntent {
    init(title: String) {
        self.init()
        self.title = title
    }

    func performForCheck() async throws {
        _ = try await perform()
    }
}
#endif
