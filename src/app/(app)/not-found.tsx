"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { forgetPlace } from "@/lib/places";

/**
 * Something that's gone, like a deleted note. Its section stops reopening it,
 * and Luke lands back on the section's start (Notes, Documents…).
 */
export default function NotFound() {
  const pathname = usePathname();
  const router = useRouter();
  const section = pathname.match(/^\/[^/]+/)?.[0] ?? "/";
  useEffect(() => {
    forgetPlace(pathname);
    if (section !== pathname) router.replace(section);
  }, [pathname, section, router]);

  return (
    <div className="flex grow flex-col items-center justify-center gap-2 px-5 py-20 text-center">
      <p className="font-medium text-ink">This isn&apos;t here any more</p>
      <Link href="/" className="text-meta text-muted-foreground hover:text-foreground">
        Go to Dashboard
      </Link>
    </div>
  );
}
