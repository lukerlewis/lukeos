import { NextResponse, type NextRequest } from "next/server";

// Quick first check: no session cookie means not signed in. Pages still
// verify the session properly against the database.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("lukeos_session")) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except sign-in, auth/ops APIs, app icons and Next's own files.
    "/((?!sign-in|api/|_next/|manifest.webmanifest|icon|apple-icon|favicon.ico).*)",
  ],
};
