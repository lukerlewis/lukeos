import { NextResponse } from "next/server";
import { z } from "zod";
import { promptInput, savePrompt } from "@/core/portfolio";
import { checkPortfolioKey } from "@/lib/portfolio-key";

/** As much as one question and its answer can need, with room to spare. */
const MAX_BYTES = 100 * 1024;

/**
 * Where Luke's portfolio site sends each visitor's question and the AI's
 * answer, after the visitor already has it. Signed with the portfolio key
 * (Authorization: Bearer), which can only add prompts.
 */
export async function POST(req: Request) {
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!(await checkPortfolioKey(key))) return NextResponse.json({ error: "That key isn't right. Make a new one in LukeOS, Portfolio > Setup." }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return NextResponse.json({ error: "Too big." }, { status: 413 });
  const parsed = promptInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const row = await savePrompt(parsed.data);
  return NextResponse.json({ saved: true, id: row.id });
}
