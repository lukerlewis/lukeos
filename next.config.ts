import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep screens you've just seen for 30 seconds, so going back to them
    // is instant. Any change you make refreshes them straight away.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
