import type { NextConfig } from "next";

const config: NextConfig = {
  // 工作区里的包直接以 TypeScript 源码导出
  transpilePackages: ["@xrss/core", "@xrss/emails", "@xrss/pipeline"],
  serverExternalPackages: ["@libsql/client", "libsql", "nodemailer"],
};

export default config;
