import { issueSignedToken } from "@vercel/blob";
import { handleUpload, handleUploadPresigned, type HandleUploadBody, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { MAX_MESSAGE_FILE_BYTES } from "@/lib/message-files";
import { blobConfigured } from "@/lib/storage";

/**
 * Lets the browser put a big file (a video) straight into Blob storage, since
 * the app itself only takes about 4 MB at a time. GET says which way the
 * store wants it done; POST hands out permission for one file.
 */

const mode = () =>
  process.env.BLOB_READ_WRITE_TOKEN ? "token" : blobConfigured() ? "presigned" : "none";

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ mode: mode() });
}

const allowed = (pathname: string) => /^messages\/[\w-]+\.[a-z0-9]{1,8}$/i.test(pathname);
const limits = { maximumSizeInBytes: MAX_MESSAGE_FILE_BYTES, validUntil: () => Date.now() + 60 * 60_000 };

export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => null);
  try {
    if (mode() === "token") {
      const out = await handleUpload({
        request: req,
        body: body as HandleUploadBody,
        onBeforeGenerateToken: async (pathname) => {
          if (!allowed(pathname)) throw new Error("Not allowed.");
          return { maximumSizeInBytes: limits.maximumSizeInBytes, validUntil: limits.validUntil(), addRandomSuffix: false, cacheControlMaxAge: 60 * 60 * 24 * 365 };
        },
      });
      return NextResponse.json(out);
    }
    if (mode() === "presigned") {
      const out = await handleUploadPresigned({
        request: req,
        body: body as HandleUploadPresignedBody,
        // No upload-finished callback is used (the app reports the upload itself), so no key is needed.
        webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY ?? "unused",
        getSignedToken: async (pathname) => {
          if (!allowed(pathname)) throw new Error("Not allowed.");
          const validUntil = limits.validUntil();
          const token = await issueSignedToken({ pathname, operations: ["put"], maximumSizeInBytes: limits.maximumSizeInBytes, validUntil });
          return { token, urlOptions: { maximumSizeInBytes: limits.maximumSizeInBytes, validUntil, addRandomSuffix: false, cacheControlMaxAge: 60 * 60 * 24 * 365 } };
        },
      });
      return NextResponse.json(out);
    }
    return NextResponse.json({ error: "Big files can't be sent yet." }, { status: 400 });
  } catch (err) {
    console.error("[messages] big upload", err);
    return NextResponse.json({ error: "Couldn't start that upload. Try again." }, { status: 400 });
  }
}
