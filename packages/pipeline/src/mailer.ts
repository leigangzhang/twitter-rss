import { Resend } from "resend";

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export interface Mailer {
  send(mail: OutgoingMail): Promise<{ id: string }>;
}

export function createResendMailer(apiKey = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM): Mailer {
  if (!apiKey || !from) throw new Error("缺少 RESEND_API_KEY 或 MAIL_FROM。试跑请加 --dry-run。");
  const resend = new Resend(apiKey);
  return {
    async send(mail) {
      const { data, error } = await resend.emails.send({ from, ...mail });
      if (error || !data) throw new Error(error?.message ?? "发送失败");
      return { id: data.id };
    },
  };
}
