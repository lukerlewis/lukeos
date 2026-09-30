import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep screens you've just seen for 30 seconds, so going back to them
    // is instant. Any change you make refreshes them straight away.
    staleTimes: { dynamic: 30 },
  },
  // The Agent log used to be called From Claude.
  redirects: async () => [{ source: "/from-claude", destination: "/agent-log", permanent: true }],
};

export default nextConfig;
