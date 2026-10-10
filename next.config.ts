import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfmake reads its font data with Node's fs, so it runs as-is rather than bundled.
  serverExternalPackages: ["pdfmake"],
  // The fonts that go into exported PDFs (src/lib/document-pdf.ts).
  outputFileTracingIncludes: { "/api/documents/**": ["./src/assets/fonts/*.ttf"] },
  experimental: {
    // Keep screens you've just seen for 30 seconds, so going back to them
    // is instant. Any change you make refreshes them straight away.
    staleTimes: { dynamic: 30 },
  },
  headers: async () => [
    // Always check for a newer service worker, rather than keep an old one.
    { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
  ],
  redirects: async () => [
    // Agents used to be called From Claude, then Agent log.
    { source: "/from-claude", destination: "/agents", permanent: true },
    { source: "/agent-log", destination: "/agents", permanent: true },
    // SOPs are now called skills.
    { source: "/agents/sops/:id", destination: "/agents/skills/:id", permanent: true },
    // The board is now a layout on the dashboard.
    { source: "/board", destination: "/", permanent: true },
  ],
};

export default nextConfig;
