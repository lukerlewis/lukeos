// pdfmake 0.3's Node build: just the parts LukeOS uses (src/lib/document-pdf.ts).
declare module "pdfmake" {
  const pdfmake: {
    virtualfs: { writeFileSync(name: string, data: Buffer): void };
    setFonts(fonts: Record<string, { normal: string; bold: string; italics: string; bolditalics: string }>): void;
    setUrlAccessPolicy(allow: (url: string) => boolean): void;
    setLocalAccessPolicy(allow: (path: string) => boolean): void;
    createPdf(definition: unknown): { getBuffer(): Promise<Buffer> };
  };
  export default pdfmake;
}
