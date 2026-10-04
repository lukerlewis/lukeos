import "server-only";
import { and, desc, eq, getTableColumns, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import sharp from "sharp";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";
import { db, schema } from "@/db";
import type { MessageAttachmentRow } from "@/db/schema";
import { attachmentKind, MAX_ATTACHMENTS, MAX_MESSAGE_FILE_BYTES, type AttachmentKind } from "@/lib/message-files";
import { preparePicture } from "@/lib/picture";
import { adoptBlob, readStoredBytes, storageUsage, storeFile } from "@/lib/storage";
import { defineOperation, madeByColumns, madeByOf, OperationError, type MadeBy } from "./define";
import { sendPush } from "./push";

/**
 * Messages: a text chain between Luke and Claude. Luke texts a request any
 * time; Claude reads it at the next check-in (get_inbox), does it, and texts
 * back. Any Claude can also text Luke first (a routine finishing, something
 * it found), and each of Claude's texts sends a notification to his phone.
 * Either side can send photos, videos and files with a message.
 */

const { messages, storedFiles } = schema;

export const linkTypes = ["task", "note", "document", "artifact", "project", "routine", "entry", "inspiration"] as const;
export type LinkType = (typeof linkTypes)[number];

export type Attachment = {
  /** The file's id: get_message_attachment looks at it, and send_message can send it again. */
  id: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  bytes: number;
  /** In the app: the file, and for photos a small copy for the chain. */
  url: string;
  thumb: string | null;
  width: number | null;
  height: number | null;
};

export type Message = {
  id: string;
  text: string;
  attachments: Attachment[];
  from: "luke" | "claude";
  madeBy: MadeBy;
  /** Something in LukeOS the message is about. Title is empty if it's been deleted. */
  link: { type: LinkType; id: string; title: string } | null;
  createdAt: Date;
  /** Claude's messages: Luke has seen it. */
  read: boolean;
  /** Luke's messages: Claude has dealt with it. */
  answered: boolean;
  answeredAt: Date | null;
};

const linkTitle = sql<string | null>`case ${messages.linkType}
  when 'task' then (select t.title from tasks t where t.id = ${messages.linkId} and t.deleted_at is null)
  when 'note' then (select coalesce(nullif(n.title, ''), 'Untitled note') from notes n where n.id = ${messages.linkId} and n.deleted_at is null)
  when 'document' then (select coalesce(nullif(d.title, ''), 'Untitled document') from documents d where d.id = ${messages.linkId} and d.deleted_at is null)
  when 'artifact' then (select a.title from artifacts a where a.id = ${messages.linkId} and a.deleted_at is null)
  when 'project' then (select p.name from projects p where p.id = ${messages.linkId} and p.deleted_at is null)
  when 'routine' then (select r.title from routines r where r.id = ${messages.linkId} and r.deleted_at is null)
  when 'entry' then (select coalesce(nullif(e.title, ''), 'Untitled entry') from archive_entries e where e.id = ${messages.linkId} and e.deleted_at is null)
  when 'inspiration' then (select coalesce(nullif(i.title, ''), 'Inspiration') from inspiration_items i where i.id = ${messages.linkId} and i.deleted_at is null)
end`;

const toAttachment = (a: MessageAttachmentRow): Attachment => ({
  id: a.fileId,
  kind: a.kind,
  name: a.name,
  mimeType: a.mimeType,
  bytes: a.bytes,
  url: `/api/stored/${a.fileId}`,
  thumb: a.thumbId ? `/api/stored/${a.thumbId}` : null,
  width: a.width ?? null,
  height: a.height ?? null,
});

function toMessage(row: typeof messages.$inferSelect & { linkTitle: string | null }): Message {
  const madeBy = madeByOf(row);
  return {
    id: row.id,
    text: row.body,
    attachments: (row.attachments ?? []).map(toAttachment),
    from: madeBy.kind === "agent" ? "claude" : "luke",
    madeBy,
    link: row.linkType && row.linkId ? { type: row.linkType as LinkType, id: row.linkId, title: row.linkTitle ?? "" } : null,
    createdAt: row.createdAt,
    read: row.readAt !== null,
    answered: row.answeredAt !== null,
    answeredAt: row.answeredAt,
  };
}

/** The chain, oldest first. `waiting` gives only Luke's messages Claude hasn't dealt with. */
export async function listMessages(filter: { limit?: number; before?: Date; waiting?: boolean; ids?: string[] } = {}) {
  const conditions: (SQL | undefined)[] = [];
  if (filter.before) conditions.push(lt(messages.createdAt, filter.before));
  if (filter.waiting) conditions.push(eq(messages.createdByKind, "user"), isNull(messages.answeredAt));
  if (filter.ids) conditions.push(inArray(messages.id, filter.ids.length ? filter.ids : ["00000000-0000-0000-0000-000000000000"]));
  // The newest ones, put back in order.
  const rows = await db
    .select({ ...getTableColumns(messages), linkTitle })
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(filter.limit ?? 100);
  return rows.reverse().map(toMessage);
}

/** How many of Claude's messages Luke hasn't seen yet. */
export async function unreadMessageCount() {
  const rows = await db.execute<{ n: number }>(
    sql`select count(*) as n from messages where created_by_kind = 'agent' and read_at is null`,
  );
  return Number(rows.rows[0].n);
}

async function assertLink(type: LinkType, id: string) {
  const table = { task: schema.tasks, note: schema.notes, document: schema.documents, artifact: schema.artifacts, project: schema.projects, routine: schema.routines, entry: schema.archiveEntries, inspiration: schema.inspirationItems }[type];
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
  if (!row) throw new OperationError(`That ${type} doesn't exist.`, 404);
}

const cleanName = (name: string) => name.replace(/[\\/\r\n]+/g, " ").trim().slice(0, 200) || "File";

async function assertRoom() {
  if ((await storageUsage()).full) throw new OperationError("LukeOS storage is full. Delete some things to make room.", 507);
}

/**
 * Keeps one file for a message: photos are shrunk (2000px WebP, plus a small
 * copy for the chain), anything else is kept as it is. Returns what to attach.
 */
export async function saveMessageFile(file: { data: Buffer; name: string; mimeType: string }): Promise<MessageAttachmentRow> {
  if (file.data.length === 0) throw new OperationError("That file is empty.");
  if (file.data.length > MAX_MESSAGE_FILE_BYTES) throw new OperationError("That file is over 100 MB.");
  await assertRoom();
  const mimeType = file.mimeType.slice(0, 200) || "application/octet-stream";
  const name = cleanName(file.name);
  if (attachmentKind(mimeType) === "image" || /\.hei[cf]$/i.test(name)) {
    let picture: Awaited<ReturnType<typeof preparePicture>> | null = null;
    try {
      picture = await preparePicture(file.data);
    } catch {
      // Not a picture after all: keep it as a file.
    }
    if (picture) {
      const [display, thumb] = await Promise.all([
        storeFile(picture.display.data, picture.display.mimeType, "messages"),
        storeFile(picture.thumb.data, picture.thumb.mimeType, "messages"),
      ]);
      return {
        fileId: display.id,
        thumbId: thumb.id,
        kind: "image",
        name: name.replace(/\.(hei[cf]|jpe?g|png|gif|avif|tiff?)$/i, ".webp"),
        mimeType: picture.display.mimeType,
        bytes: display.bytes,
        width: picture.width,
        height: picture.height,
      };
    }
  }
  const stored = await storeFile(file.data, mimeType, "messages");
  return { fileId: stored.id, kind: attachmentKind(mimeType), name, mimeType, bytes: stored.bytes };
}

/** A big file the app put straight into Blob storage, kept for a message. */
export async function adoptMessageBlob(input: {
  url: string;
  access: "private" | "public";
  name: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
}): Promise<MessageAttachmentRow> {
  await assertRoom();
  const mimeType = input.mimeType.slice(0, 200) || "application/octet-stream";
  let stored;
  try {
    stored = await adoptBlob(input.url, mimeType, input.access);
  } catch {
    throw new OperationError("That upload didn't arrive. Try again.", 400);
  }
  if (stored.bytes > MAX_MESSAGE_FILE_BYTES) throw new OperationError("That file is over 100 MB.");
  const kind = attachmentKind(mimeType);
  return {
    fileId: stored.id,
    kind,
    name: cleanName(input.name),
    mimeType,
    bytes: stored.bytes,
    ...(kind !== "file" && { width: input.width ?? null, height: input.height ?? null }),
  };
}

/** An attachment already sent in some message, found by its file id. */
async function findAttachment(fileId: string) {
  const rows = await db
    .select({ attachments: messages.attachments })
    .from(messages)
    .where(sql`${messages.attachments} @> ${JSON.stringify([{ fileId }])}::jsonb`)
    .limit(1);
  return rows[0]?.attachments.find((a) => a.fileId === fileId) ?? null;
}

const uploadedAttachment = z.object({
  fileId: z.uuid(),
  thumbId: z.uuid().nullable().optional(),
  name: z.string().max(300).optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
});
const newAttachment = z.object({
  name: z.string().trim().min(1).max(300).describe('The file name, e.g. "Floor plan.pdf" or "Kitchen.jpg".'),
  mimeType: z.string().trim().min(1).max(200).describe('The file type, e.g. "image/jpeg" or "application/pdf".'),
  data: z.base64().describe("The file, base64 encoded."),
});

/** Turns what send_message was given into what the message keeps. */
async function attachmentsFrom(input: (z.infer<typeof uploadedAttachment> | z.infer<typeof newAttachment>)[]) {
  const out: MessageAttachmentRow[] = [];
  for (const a of input) {
    if ("data" in a) {
      const data = Buffer.from(a.data, "base64");
      if (data.length > 3 * 1024 * 1024) throw new OperationError(`${a.name} is over 3 MB.`);
      out.push(await saveMessageFile({ data, name: a.name, mimeType: a.mimeType }));
      continue;
    }
    const ids = [a.fileId, ...(a.thumbId ? [a.thumbId] : [])];
    const found = await db.select({ id: storedFiles.id, mimeType: storedFiles.mimeType, bytes: storedFiles.bytes }).from(storedFiles).where(inArray(storedFiles.id, ids));
    const file = found.find((f) => f.id === a.fileId);
    if (!file || found.length !== ids.length) throw new OperationError("That file isn't in LukeOS any more.", 404);
    const earlier = await findAttachment(a.fileId);
    const kind = attachmentKind(file.mimeType);
    out.push({
      fileId: a.fileId,
      thumbId: a.thumbId ?? earlier?.thumbId ?? null,
      kind,
      name: cleanName(a.name || earlier?.name || "File"),
      mimeType: file.mimeType,
      bytes: file.bytes,
      width: a.width ?? earlier?.width ?? null,
      height: a.height ?? earlier?.height ?? null,
    });
  }
  return out;
}

const textLike = /^(text\/|application\/(json|xml|csv|x-yaml|yaml|javascript))/;

/** What Claude gets back for an attachment: the picture itself, or the words in a document. */
async function lookAt(a: MessageAttachmentRow) {
  const info = toAttachment(a);
  if (a.kind === "video")
    return { ...info, note: "This is a video, which you can't watch. Ask Luke what's in it if it matters." };
  const file = await readStoredBytes(a.fileId);
  if (!file) return { ...info, note: "The file is missing." };
  if (a.kind === "image") {
    const data = await sharp(file.data).resize({ width: 1500, height: 1500, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    return { ...info, __images: [{ data: data.toString("base64"), mimeType: "image/webp" }] };
  }
  const limit = 200_000;
  if (a.mimeType === "application/pdf") {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(file.data));
      const { totalPages, text } = await extractText(pdf, { mergePages: true });
      const words = text.trim();
      return {
        ...info,
        pages: totalPages,
        text: words.slice(0, limit),
        ...(words.length > limit && { truncated: true }),
        ...(!words && { note: "This PDF has no text in it (probably scanned pages)." }),
      };
    } catch {
      return { ...info, note: "This PDF couldn't be read." };
    }
  }
  if (textLike.test(a.mimeType) || /\.(txt|md|csv|json|ya?ml|html?|xml|ics|vcf)$/i.test(a.name)) {
    const text = file.data.toString("utf8");
    return { ...info, text: text.slice(0, limit), ...(text.length > limit && { truncated: true }) };
  }
  return { ...info, note: "LukeOS can't read inside this kind of file." };
}

/** What the push notification says when a message is only attachments. */
function attachmentsLine(list: MessageAttachmentRow[]) {
  const kinds = new Set(list.map((a) => a.kind));
  const what = kinds.size > 1 ? "files" : kinds.has("image") ? "photo" : kinds.has("video") ? "video" : "file";
  return list.length > 1 ? `Sent ${list.length} ${what === "files" ? "files" : `${what}s`}` : `Sent a ${what}`;
}

const preview = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 180 ? `${flat.slice(0, 179)}…` : flat;
};

export const messageOperations = {
  list_messages: defineOperation({
    name: "list_messages",
    description:
      "The Messages chain between Luke and Claude, oldest first (the newest at the end), like a text conversation. Each message says who sent it (from \"luke\" or \"claude\"), when, anything in LukeOS it's about (link), and any photos, videos or files sent with it (attachments; look at one with get_message_attachment). Luke's messages show whether they've been answered. waiting: true gives only Luke's messages nobody has dealt with yet (get_inbox lists these too).",
    input: z.object({
      waiting: z.boolean().optional().describe("Only Luke's messages that haven't been answered."),
      limit: z.number().int().min(1).max(200).optional().describe("How many of the most recent messages. Defaults to 100."),
    }),
    run: async ({ waiting, limit }) => listMessages({ waiting, limit }),
  }),

  send_message: defineOperation({
    name: "send_message",
    description:
      "Text Luke in his Messages chain. It sends a notification to his phone, so keep it short and worth his attention: one to three plain sentences, like a text from a helpful colleague. Use it to answer his messages (pass their ids as answers, so they stop showing as waiting), to tell him something finished or needs him, or when he asks you to let him know something. Long write-ups go in a document (create_document); link it here instead of pasting it. link points at one task, document, note, project, routine, Work archive entry or Inspiration item, shown as a card he can tap. attachments sends photos or files with it (photos show in the chain; other files as a card he taps to open), each up to 3 MB; to send one again, pass its id as fileId.",
    input: z.object({
      text: z.string().trim().max(4000).optional().describe("The message. Plain text; short. Can be left out when sending attachments."),
      link: z
        .object({ type: z.enum(linkTypes), id: z.uuid() })
        .optional()
        .describe("Something in LukeOS this is about, e.g. the document you just made."),
      answers: z
        .array(z.uuid())
        .max(100)
        .optional()
        .describe("Ids of Luke's messages this deals with (from get_inbox or list_messages). They stop showing as waiting."),
      attachments: z
        .array(z.union([newAttachment, uploadedAttachment]))
        .max(MAX_ATTACHMENTS)
        .optional()
        .describe("Photos or files to send: name, mimeType and base64 data for a new one, or fileId for one already in Messages."),
    }),
    run: async ({ text = "", link, answers, attachments: given }, { actor }) => {
      if (link) await assertLink(link.type, link.id);
      const attachments = given?.length ? await attachmentsFrom(given) : [];
      if (!text && !attachments.length) throw new OperationError("Write something, or attach a file.");
      const [row] = await db
        .insert(messages)
        .values({
          body: text,
          attachments,
          linkType: link?.type ?? null,
          linkId: link?.id ?? null,
          // Luke's own messages count as read; Claude's count as answered.
          readAt: actor.kind === "user" ? new Date() : null,
          ...madeByColumns(actor),
        })
        .returning({ id: messages.id });
      if (actor.kind === "agent") {
        if (answers?.length)
          await db
            .update(messages)
            .set({ answeredAt: new Date(), answeredBy: row.id })
            .where(and(inArray(messages.id, answers), eq(messages.createdByKind, "user"), isNull(messages.answeredAt)));
        await sendPush({
          title: actor.routine ? `${actor.name} · ${actor.routine}` : actor.name,
          body: text ? preview(text) : attachmentsLine(attachments),
          url: "/messages",
          badge: await unreadMessageCount(),
          tag: "lukeos-messages",
        });
      }
      return (await listMessages({ ids: [row.id], limit: 1 }))[0];
    },
  }),

  get_message_attachment: defineOperation({
    name: "get_message_attachment",
    description:
      "Look at a photo, video or file sent in Messages (its id is in the message's attachments). You see photos as pictures, and get the text of PDFs and text files. Videos can't be watched.",
    input: z.object({ id: z.uuid().describe("The attachment's id, from list_messages or get_inbox.") }),
    run: async ({ id }) => {
      const found = await findAttachment(id);
      if (!found) throw new OperationError("That attachment doesn't exist.", 404);
      return lookAt(found);
    },
  }),

  mark_messages_read: defineOperation({
    name: "mark_messages_read",
    description: "Marks Claude's messages as seen. The app does this when Luke opens Messages; agents don't need to.",
    input: z.object({}),
    run: async () => {
      await db
        .update(messages)
        .set({ readAt: new Date() })
        .where(and(eq(messages.createdByKind, "agent"), isNull(messages.readAt)));
      return { unread: 0 };
    },
  }),
};

