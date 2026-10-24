import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["playwright", "bullmq", "ioredis", "prisma", "@prisma/client", "nodemailer"],
};

export default nextConfig;
