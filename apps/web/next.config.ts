import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Served under a path when the deployment says so (the public address is https://<host>/edith); empty in dev and tests.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  transpilePackages: ["@edith/ops"],
  /* config options here */
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
