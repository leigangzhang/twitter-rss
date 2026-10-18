import nodemailer from "nodemailer";

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export interface Mailer {
  send(mail: OutgoingMail): Promise<{ id: string }>;
  close(): void;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/**
 * 从环境变量读取 SMTP 配置。默认是 QQ 邮箱：smtp.qq.com，465 端口 SSL。
 * SMTP_PASS 是 QQ 邮箱的"授权码"（设置 → 账户 → 开启 SMTP 服务后生成），不是登录密码。
 * 返回 null 表示未配置。
 */
export function smtpConfigFromEnv(env = process.env): SmtpConfig | null {
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS?.trim();
  if (!user || !pass) return null;
  const port = Number(env.SMTP_PORT || 465);
  return {
    host: env.SMTP_HOST || "smtp.qq.com",
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465,
    user,
    pass,
    // QQ 邮箱要求发件地址与登录账号一致，这里只允许改显示名
    from: env.MAIL_FROM?.trim() || `精选晨报 <${user}>`,
  };
}

/** QQ 邮箱对发送频率有限制，逐封发送并在两封之间等待一段时间 */
export function createSmtpMailer(cfg: SmtpConfig, opts: { intervalMs?: number } = {}): Mailer {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    pool: true,
    maxConnections: 1,
  });
  const interval = opts.intervalMs ?? 1500;
  let last = 0;
  return {
    async send(mail) {
      const wait = last + interval - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      const info = await transport.sendMail({ from: cfg.from, ...mail });
      return { id: info.messageId };
    },
    close() {
      transport.close();
    },
  };
}
