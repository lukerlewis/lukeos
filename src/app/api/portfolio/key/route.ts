import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { newPortfolioKey } from "@/lib/portfolio-key";

/** Makes a new key for the portfolio site. The old one stops working. Shown once. */
export async function POST() {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ key: await newPortfolioKey() });
}
