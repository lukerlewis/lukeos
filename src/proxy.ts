import { NextResponse, type NextRequest } from "next/server";

// Quick first check: no session cookie means not signed in. Pages still
// verify the session properly against the database.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("lukeos_session")) {
    const signIn = new URL("/sign-in", request.url);
    const { pathname, search } = request.nextUrl;
    if (pathname !== "/") signIn.searchParams.set("next", pathname + search);
    return NextResponse.redirect(signIn);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except sign-in, APIs, Claude's connector discovery, the service worker, app icons and Next's own files.
    "/((?!sign-in|api/|\\.well-known/|_next/|manifest.webmanifest|sw.js|icon|apple-icon|favicon.ico).*)",
  ],
};
