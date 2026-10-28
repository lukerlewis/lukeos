"use client";

import { Globe } from "lucide-react";
import { useState } from "react";

/** The site's own little icon, or a globe if it has none. */
export function SiteIcon({ site }: { site: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Globe className="mt-0.5 size-5 shrink-0 text-icon" aria-hidden />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a tiny remote icon, not worth the image optimiser
    <img
      // An icon that failed before the page came alive never fires onError, so check on mount too.
      ref={(img) => {
        if (img?.complete && img.naturalWidth === 0) setFailed(true);
      }}
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(site)}&sz=64`}
      alt=""
      className="mt-0.5 size-5 shrink-0 rounded-[4px]"
      onError={() => setFailed(true)}
    />
  );
}
