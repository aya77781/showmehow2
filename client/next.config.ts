import type { NextConfig } from "next";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      // fallback runs only if nothing else matched — so /api/admin/* (Next.js
      // route handlers) wins, and everything else under /api/* is proxied to
      // the Express backend.
      fallback: [
        {
          source: "/api/:path*",
          destination: `${API_URL}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
