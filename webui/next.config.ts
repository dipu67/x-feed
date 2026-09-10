import type { NextConfig } from "next";

const backend = (process.env.BACKEND_URL ?? "http://localhost:5500").replace(
  /\/$/,
  "",
);

const nextConfig: NextConfig = {
  // webui is its own npm project nested in the backend repo. Without this,
  // Turbopack sees both lockfiles and guesses the repo root instead.
  turbopack: {
    root: import.meta.dirname,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "abs.twimg.com" },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/:path*`,
      },
    ];
  },
};

export default nextConfig;
