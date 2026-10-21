import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  webpack: (config, { dev }) => {
    // SQLite writes (dev.db, -journal) and generated files must not trigger dev recompiles.
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ["**/node_modules/**", "**/.git/**", "**/prisma/*.db*", "**/.tmp/**", "**/samples/**", "**/uploads/**"],
      };
    }
    return config;
  },
};

export default nextConfig;
