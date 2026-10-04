import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { marked, type Token, type Tokens } from "marked";
import pdfmake from "pdfmake";
import sharp from "sharp";
import { getImage } from "@/core/notes";

/**
 * Turns a document's Markdown into a real PDF (selectable text, not a
 * picture): US Letter, 1 inch margins, Inter at the same sizes as the page on
 * screen (see .doc-page in globals.css), so it looks like what Luke wrote.
 */

// pdfmake's own types are loose; these are the shapes this file builds.
type Content = Record<string, unknown> | string;
type Inline = Record<string, unknown> | string;

const CONTENT_WIDTH = 468; // 8.5in page minus two 1in margins, in points
const BODY = 11;
const LINE = 1.24; // Inter's own line height is ~1.21, so this is ~1.5 like the screen
const GAP = 8; // space after a paragraph (0.75em)
const INK = "#09090b";
const MUTED = "#52525b";
const RULE = "#e4e4e7";
const LINK = "#2563eb";

let fontsReady = false;
function loadFonts() {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), "src/assets/fonts");
  for (const file of ["Inter-Regular.ttf", "Inter-SemiBold.ttf", "Inter-Italic.ttf", "Inter-SemiBoldItalic.ttf", "GeistMono-Regular.ttf"]) {
    pdfmake.virtualfs.writeFileSync(file, readFileSync(path.join(dir, file)));
  }
  pdfmake.setFonts({
    Inter: {
      normal: "Inter-Regular.ttf",
      bold: "Inter-SemiBold.ttf",
      italics: "Inter-Italic.ttf",
      bolditalics: "Inter-SemiBoldItalic.ttf",
    },
    Mono: {
      normal: "GeistMono-Regular.ttf",
      bold: "GeistMono-Regular.ttf",
      italics: "GeistMono-Regular.ttf",
      bolditalics: "GeistMono-Regular.ttf",
    },
  });
  // Everything is handed over in memory: nothing is read from disk or the web.
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy(() => false);
  fontsReady = true;
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => entities[e]);

type Marks = { bold?: boolean; italics?: boolean; strike?: boolean; link?: string; mono?: boolean };

/** Photos saved in LukeOS (/api/images/...), as PNG or JPEG data pdfmake can draw, with their width in points. */
async function loadPicture(src: string): Promise<{ data: string; width: number } | null> {
  const id = src.match(/\/api\/images\/([0-9a-f-]{36})/i)?.[1];
  if (!id) return null;
  const image = await getImage(id);
  if (!image) return null;
  try {
    const pic = sharp(Buffer.from(image.data)).rotate();
    const meta = await pic.metadata();
    const png = await pic.flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
    // Shown at the size the screen would (one pixel = 3/4 point), never wider than the page.
    const width = Math.min(CONTENT_WIDTH, Math.round((meta.width ?? 800) * 0.75));
    return { data: `data:image/jpeg;base64,${png.toString("base64")}`, width };
  } catch {
    return null;
  }
}

class Builder {
  private pictures = new Map<string, { data: string; width: number } | null>();

  /** Fetches every photo up front, so building the layout can stay simple. */
  async preload(tokens: Token[]) {
    const srcs: string[] = [];
    marked.walkTokens(tokens, (t) => {
      if (t.type === "image") srcs.push((t as Tokens.Image).href);
    });
    await Promise.all(
      [...new Set(srcs)].map(async (src) => {
        this.pictures.set(src, await loadPicture(src));
      }),
    );
  }

  inline(tokens: Token[] | undefined, marks: Marks = {}): Inline[] {
    const out: Inline[] = [];
    for (const t of tokens ?? []) {
      switch (t.type) {
        case "strong":
          out.push(...this.inline((t as Tokens.Strong).tokens, { ...marks, bold: true }));
          break;
        case "em":
          out.push(...this.inline((t as Tokens.Em).tokens, { ...marks, italics: true }));
          break;
        case "del":
          out.push(...this.inline((t as Tokens.Del).tokens, { ...marks, strike: true }));
          break;
        case "link":
          out.push(...this.inline((t as Tokens.Link).tokens, { ...marks, link: (t as Tokens.Link).href }));
          break;
        case "codespan":
          out.push(this.span(decode((t as Tokens.Codespan).text), { ...marks, mono: true }));
          break;
        case "br":
          out.push("\n");
          break;
        case "image":
          // Photos are drawn as their own blocks (see blocks()); here they leave nothing behind.
          break;
        case "html":
          out.push(this.span(decode((t as Tokens.HTML).text.replace(/<[^>]+>/g, "")), marks));
          break;
        default: {
          const text = t as Tokens.Text;
          if (text.tokens?.length) out.push(...this.inline(text.tokens, marks));
          else out.push(this.span(decode(text.text ?? ""), marks));
        }
      }
    }
    return out;
  }

  private span(text: string, marks: Marks): Inline {
    if (!text) return "";
    return {
      text,
      ...(marks.bold && { bold: true }),
      ...(marks.italics && { italics: true }),
      ...(marks.strike && { decoration: "lineThrough" }),
      ...(marks.mono && { font: "Mono", fontSize: BODY * 0.9, background: "#f4f4f5" }),
      ...(marks.link && /^(https?:|mailto:)/i.test(marks.link) && { link: marks.link, color: LINK, decoration: "underline" }),
    };
  }

  /** A paragraph's text, with any photos in it placed after it as blocks. */
  private paragraph(tokens: Token[] | undefined, style: Record<string, unknown> = {}): Content[] {
    const out: Content[] = [];
    let run: Token[] = [];
    const flush = () => {
      const text = this.inline(run);
      if (text.some((t) => (typeof t === "string" ? t.trim() : String((t as { text: string }).text).trim())))
        out.push({ text, margin: [0, 0, 0, GAP], ...style });
      run = [];
    };
    for (const t of tokens ?? []) {
      if (t.type === "image") {
        flush();
        const pic = this.pictures.get((t as Tokens.Image).href);
        if (pic) out.push({ image: pic.data, width: pic.width, margin: [0, 2, 0, GAP + 2] });
      } else run.push(t);
    }
    flush();
    return out;
  }

  blocks(tokens: Token[]): Content[] {
    const out: Content[] = [];
    for (const t of tokens) {
      switch (t.type) {
        case "heading": {
          const h = t as Tokens.Heading;
          const size = h.depth === 1 ? 20 : h.depth === 2 ? 15 : 12.5;
          const before = h.depth === 1 ? 14 : h.depth === 2 ? 12 : 9;
          out.push({
            text: this.inline(h.tokens),
            fontSize: size,
            bold: true,
            lineHeight: 1.05,
            margin: [0, out.length ? before : 0, 0, 6],
            headlineLevel: h.depth,
          });
          break;
        }
        case "paragraph":
          out.push(...this.paragraph((t as Tokens.Paragraph).tokens));
          break;
        case "text": {
          const text = t as Tokens.Text;
          out.push(...this.paragraph(text.tokens ?? [{ type: "text", raw: text.raw, text: text.text } as Tokens.Text]));
          break;
        }
        case "list":
          out.push(this.list(t as Tokens.List));
          break;
        case "blockquote":
          out.push({
            table: { widths: ["*"], body: [[{ stack: this.blocks((t as Tokens.Blockquote).tokens), color: MUTED }]] },
            layout: {
              hLineWidth: () => 0,
              vLineWidth: (i: number) => (i === 0 ? 3 : 0),
              vLineColor: () => RULE,
              paddingLeft: () => 12,
              paddingRight: () => 0,
              paddingTop: () => 0,
              paddingBottom: () => 0,
            },
            margin: [0, 0, 0, GAP],
          });
          break;
        case "code":
          out.push({
            table: { widths: ["*"], body: [[{ text: (t as Tokens.Code).text, font: "Mono", fontSize: BODY * 0.85, preserveLeadingSpaces: true }]] },
            layout: {
              hLineWidth: () => 0,
              vLineWidth: () => 0,
              fillColor: () => "#f4f4f5",
              paddingLeft: () => 10,
              paddingRight: () => 10,
              paddingTop: () => 8,
              paddingBottom: () => 8,
            },
            margin: [0, 0, 0, GAP],
          });
          break;
        case "hr":
          out.push({
            canvas: [{ type: "line", x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.75, lineColor: RULE }],
            margin: [0, 10, 0, 16],
          });
          break;
        case "table":
          out.push(this.table(t as Tokens.Table));
          break;
        case "html": {
          const text = decode((t as Tokens.HTML).text.replace(/<[^>]+>/g, "")).trim();
          if (text) out.push({ text, margin: [0, 0, 0, GAP] });
          break;
        }
        // "space", and anything unknown, leaves nothing on the page.
      }
    }
    return out;
  }

  private list(list: Tokens.List): Content {
    const items = list.items.map((item) => {
      const stack = this.blocks(item.tokens.filter((t) => t.type !== "checkbox"));
      // Items in a tight list don't need a paragraph's gap under them.
      const tightened = stack.map((b, i) =>
        i === stack.length - 1 && typeof b === "object" && "text" in b ? { ...b, margin: [0, 0, 0, 3] } : b,
      );
      if (!item.task) return { stack: tightened };
      const box: Record<string, unknown>[] = [
        { type: "rect", x: 0, y: 3, w: 9, h: 9, r: 2, lineWidth: 0.9, lineColor: item.checked ? "#15803d" : "#a1a1aa", ...(item.checked && { color: "#15803d" }) },
      ];
      if (item.checked) box.push({ type: "polyline", lineWidth: 1.3, lineColor: "#ffffff", points: [{ x: 2.2, y: 7.6 }, { x: 4, y: 9.4 }, { x: 7, y: 5.6 }] });
      return {
        columns: [
          { width: 15, canvas: box },
          { width: "*", stack: tightened },
        ],
        columnGap: 0,
      };
    });
    if (list.items.every((i) => i.task)) return { stack: items, margin: [0, 0, 0, GAP] };
    return list.ordered
      ? { ol: items, start: Number(list.start) || 1, margin: [0, 0, 0, GAP], markerColor: INK }
      : { ul: items, margin: [0, 0, 0, GAP], markerColor: INK };
  }

  private table(table: Tokens.Table): Content {
    const cell = (c: Tokens.TableCell, header: boolean) => ({
      text: this.inline(c.tokens),
      bold: header,
      ...(c.align && { alignment: c.align }),
    });
    return {
      table: {
        headerRows: 1,
        widths: table.header.map(() => "*"),
        body: [table.header.map((c) => cell(c, true)), ...table.rows.map((row) => row.map((c) => cell(c, false)))],
      },
      layout: {
        hLineWidth: () => 0.75,
        vLineWidth: () => 0.75,
        hLineColor: () => RULE,
        vLineColor: () => RULE,
        fillColor: (row: number) => (row === 0 ? "#f4f4f5" : null),
        paddingLeft: () => 6,
        paddingRight: () => 6,
        paddingTop: () => 4,
        paddingBottom: () => 4,
      },
      margin: [0, 0, 0, GAP],
    };
  }
}

/** The PDF for a document, as bytes. */
export async function documentPdf(doc: { title: string; content: string; author: string }): Promise<Buffer> {
  loadFonts();
  const tokens = marked.lexer(doc.content, { gfm: true });
  const builder = new Builder();
  await builder.preload(tokens);
  const content = builder.blocks(tokens);

  const pdf = pdfmake.createPdf({
    info: { title: doc.title || "Untitled", author: doc.author, creator: "LukeOS" },
    pageSize: "LETTER",
    pageMargins: [72, 72, 72, 72],
    defaultStyle: { font: "Inter", fontSize: BODY, lineHeight: LINE, color: INK },
    content: content.length ? content : [{ text: "" }],
    // A heading never sits alone at the bottom of a page.
    pageBreakBefore: (node: { headlineLevel?: number }, following: unknown[]) => !!node.headlineLevel && following.length === 0,
  } as never);
  return (await pdf.getBuffer()) as Buffer;
}
