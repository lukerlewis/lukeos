import Foundation

struct FolderRef: Codable, Hashable, Sendable { var id: String; var name: String }

struct NoteSummary: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var title: String
    var format: String?
    var excerpt: String?
    var project: ProjectRef?
    var folder: FolderRef?
    var pinned: Bool?
    var madeBy: MadeBy?
    var createdAt: String?
    var updatedAt: String?

    var displayTitle: String { title.isEmpty ? "Untitled" : title }
}

struct Note: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var title: String
    var format: String?
    var content: String
    var project: ProjectRef?
    var folder: FolderRef?
    var pinned: Bool?
    var madeBy: MadeBy?
    var updatedAt: String?

    var isHTML: Bool { format == "html" }
}

struct Folder: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var name: String
    var project: ProjectRef?
    var noteCount: Int?
}
