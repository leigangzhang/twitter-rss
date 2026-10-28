import type { NextConfig } from "next";

/** 所有页面的安全响应头：不允许被别的网站嵌入、不猜测文件类型、跳到外站时只带域名不带路径（路径里有个人 token） */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // 只在 https 下生效；不加 includeSubDomains，同域名下的其他网站不受影响
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const config: NextConfig = {
  // 工作区里的包直接以 TypeScript 源码导出
  transpilePackages: ["@xrss/core", "@xrss/collector", "@xrss/emails", "@xrss/pipeline"],
  serverExternalPackages: ["@libsql/client", "libsql", "nodemailer"],
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
      { source: "/api/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
};

export default config;
