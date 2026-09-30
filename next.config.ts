import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep screens you've just seen for 30 seconds, so going back to them
    // is instant. Any change you make refreshes them straight away.
    staleTimes: { dynamic: 30 },
  },
  redirects: async () => [
    // The Agent log used to be called From Claude.
    { source: "/from-claude", destination: "/agent-log", permanent: true },
    // The board is now a layout on the dashboard.
    { source: "/board", destination: "/", permanent: true },
  ],
};

export default nextConfig;
