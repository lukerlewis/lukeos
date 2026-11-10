"use client";

import { ExternalLink, FolderInput, FolderOpen, Folder as FolderIcon, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { askRename, contextMenu, type MenuEntry } from "@/components/ui/context-menu";
import { showToast } from "@/components/shell/toast";
import { inBackground, trashInBackground, useHidden } from "@/lib/background";
import { copyLinkItem, loadProjects, projectItems, tryOp } from "@/lib/menus";
import { op } from "@/lib/ops-client";
import { FolderDialog } from "./folder-dialog";

type Router = ReturnType<typeof useRouter>;

type NoteLike = { id: string; title: string; pinned: boolean; project: { id: string } | null; folder: { id: string } | null };

/** Open, pin, rename, file in a folder or project, copy a link, delete. */
export function noteMenu(note: NoteLike, router: Router): MenuEntry[] {
  const refresh = () => router.refresh();
  const save = (change: { title?: string; pinned?: boolean; projectId?: string | null; folderId?: string | null }) =>
    tryOp(() => op("update_note", { id: note.id, ...change }), refresh);
  const href = `/notes/${note.id}`;
  return [
    { label: "Open", icon: ExternalLink, onSelect: () => router.push(href) },
    "-",
    note.pinned
      ? { label: "Unpin", icon: PinOff, onSelect: () => save({ pinned: false }) }
      : { label: "Pin", icon: Pin, onSelect: () => save({ pinned: true }) },
    { label: "Rename", icon: Pencil, onSelect: () => askRename("Rename note", note.title, (title) => save({ title })) },
    {
      label: "Folder",
      icon: FolderIcon,
      items: async () => {
        const folders = await op("list_folders", {});
        return [
          { label: "No folder", checked: !note.folder, onSelect: () => note.folder && save({ folderId: null }) },
          folders.length > 0 && "-",
          ...folders.map((f) => ({ label: f.name, checked: f.id === note.folder?.id, onSelect: () => f.id !== note.folder?.id && save({ folderId: f.id }) })),
        ];
      },
    },
    { label: "Project", icon: FolderInput, items: projectItems(note.project?.id, (projectId) => save({ projectId })) },
    "-",
    copyLinkItem(href),
    "-",
    { label: "Delete", icon: Trash2, onSelect: () => trashInBackground("note", note.id, () => op("delete_note", { id: note.id }), { then: refresh }) },
  ];
}

type DocumentLike = { id: string; title: string; pinned: boolean; project: { id: string } | null };

/** Open, pin, rename, move to a project, copy a link, delete. */
export function documentMenu(doc: DocumentLike, router: Router): MenuEntry[] {
  const refresh = () => router.refresh();
  const save = (change: { title?: string; pinned?: boolean; projectId?: string | null }) =>
    tryOp(() => op("update_document", { id: doc.id, ...change }), refresh);
  const href = `/documents/${doc.id}`;
  return [
    { label: "Open", icon: ExternalLink, onSelect: () => router.push(href) },
    "-",
    doc.pinned
      ? { label: "Unpin", icon: PinOff, onSelect: () => save({ pinned: false }) }
      : { label: "Pin", icon: Pin, onSelect: () => save({ pinned: true }) },
    { label: "Rename", icon: Pencil, onSelect: () => askRename("Rename document", doc.title, (title) => save({ title })) },
    { label: "Project", icon: FolderInput, items: projectItems(doc.project?.id, (projectId) => save({ projectId })) },
    "-",
    copyLinkItem(href),
    "-",
    {
      label: "Delete",
      icon: Trash2,
      onSelect: () => trashInBackground("document", doc.id, () => op("delete_document", { id: doc.id }), { then: refresh }),
    },
  ];
}

const row = "border-b last:border-b-0";

/** A row in a list of notes, with its right-click menu. */
export function NoteRow({ note, className, children }: { note: NoteLike; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  if (useHidden(note.id)) return null;
  return (
    <li className={row}>
      <Link
        href={`/notes/${note.id}`}
        className={className}
        {...contextMenu(() => noteMenu(note, router), { ask: { kind: "note", id: note.id, title: note.title }, hold: true })}
      >
        {children}
      </Link>
    </li>
  );
}

/** A row in a list of documents, with its right-click menu. */
export function DocumentRow({ doc, className, children }: { doc: DocumentLike; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  if (useHidden(doc.id)) return null;
  return (
    <li className={row}>
      <Link
        href={`/documents/${doc.id}`}
        className={className}
        {...contextMenu(() => documentMenu(doc, router), { ask: { kind: "document", id: doc.id, title: doc.title }, hold: true })}
      >
        {children}
      </Link>
    </li>
  );
}

type FolderLike = { id: string; name: string; project: { id: string } | null };

/** A row in a list of folders: open, rename or change its project, copy a link, delete (its notes are kept). */
export function FolderRow({ folder, className, children }: { folder: FolderLike; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string; name: string }[] | null>(null);
  const href = `/notes?folder=${folder.id}`;
  if (useHidden(folder.id)) return null;

  const menu = (): MenuEntry[] => [
    { label: "Open", icon: FolderOpen, onSelect: () => router.push(href) },
    "-",
    {
      label: "Edit",
      icon: Pencil,
      onSelect: () =>
        loadProjects().then(
          (ps) => setEditing(ps.map((p) => ({ id: p.id, name: p.name }))),
          (err: Error) => showToast(err.message),
        ),
    },
    copyLinkItem(href),
    "-",
    {
      label: "Delete",
      icon: Trash2,
      onSelect: () => {
        if (!confirm(`Delete the folder "${folder.name}"? Its notes are kept.`)) return;
        void inBackground(() => op("delete_folder", { id: folder.id }), { then: () => router.refresh(), failure: "Couldn't delete the folder." });
      },
    },
  ];

  return (
    <li className={row}>
      <Link href={href} className={className} {...contextMenu(menu, { hold: true })}>
        {children}
      </Link>
      {editing && (
        <FolderDialog
          folder={{ id: folder.id, name: folder.name, projectId: folder.project?.id ?? null }}
          projects={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </li>
  );
}
