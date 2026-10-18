import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSmtpMailer, smtpConfigFromEnv } from "../src/smtp.ts";

// 本地假 SMTP 服务，验证登录、发件人和内容（真实环境是 smtp.qq.com:465）
const received: Array<{ from?: string; to: string[]; data: string; user?: string }> = [];
let server: SMTPServer;
let port = 0;

beforeAll(async () => {
  server = new SMTPServer({
    secure: false,
    authOptional: false,
    allowInsecureAuth: true,
    disabledCommands: ["STARTTLS"],
    onAuth(auth, _s, cb) {
      if (auth.username === "me@qq.com" && auth.password === "auth-code") cb(null, { user: auth.username });
      else cb(new Error("授权码错误"));
    },
    onData(stream, session, cb) {
      let data = "";
      stream.on("data", (c) => (data += c));
      stream.on("end", () => {
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : undefined,
          to: session.envelope.rcptTo.map((r) => r.address),
          data,
          user: session.user as string,
        });
        cb();
      });
    },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("SMTP 发信", () => {
  it("默认使用 QQ 邮箱配置，发件人默认与账号一致", () => {
    expect(smtpConfigFromEnv({})).toBeNull();
    expect(smtpConfigFromEnv({ SMTP_USER: "me@qq.com", SMTP_PASS: "x" })).toEqual({
      host: "smtp.qq.com",
      port: 465,
      secure: true,
      user: "me@qq.com",
      pass: "x",
      from: "精选晨报 <me@qq.com>",
    });
  });

  it("登录后发送 HTML 和纯文本，并带上退订头", async () => {
    const cfg = smtpConfigFromEnv({ SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_SECURE: "false", SMTP_USER: "me@qq.com", SMTP_PASS: "auth-code" })!;
    const mailer = createSmtpMailer(cfg, { intervalMs: 0 });
    const { id } = await mailer.send({
      to: "reader@example.com",
      subject: "精选晨报 · 10月18日 10 条",
      html: "<p>你好</p>",
      text: "你好",
      headers: { "List-Unsubscribe": "<https://example.com/unsubscribe/t>" },
    });
    mailer.close();
    expect(id).toBeTruthy();
    expect(received[0]).toMatchObject({ from: "me@qq.com", to: ["reader@example.com"], user: "me@qq.com" });
    expect(received[0]!.data).toContain("List-Unsubscribe: <https://example.com/unsubscribe/t>");
  });
});
