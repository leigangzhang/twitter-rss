import { subscribers } from "@xrss/core/db";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { SubscribeForm } from "@/components/SubscribeForm";
import { normalizeTopicIds } from "@xrss/core";
import { config, db, topicOptions } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function PreferencesPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { token } = await params;
  const { saved } = await searchParams;
  const [sub] = await (await db()).select().from(subscribers).where(eq(subscribers.token, token));
  if (!sub) {
    return (
      <Notice title="链接已失效" tone="error">
        <p className="m-0">请使用最近一封邮件底部的链接。</p>
      </Notice>
    );
  }
  return (
    <main className="flex flex-col gap-8">
      {saved === "lang" ? (
        <p role="status" className="m-0 rounded-[10px] border border-line bg-white px-4 py-3 text-sm text-[#2F7D4F]">
          已改为接收{sub.lang === "zh" ? "中文" : "原文"}，从下一封邮件开始生效。
        </p>
      ) : null}
      {sub.status === "unsubscribed" ? (
        <p className="m-0 rounded-[10px] border border-line bg-white px-4 py-3 text-sm text-muted">你已退订。保存设置即可重新订阅。</p>
      ) : null}
      <SubscribeForm
        topics={await topicOptions()}
        defaultLang={config().digest.default_language}
        maxAvatars={config().digest.subscribe_page.max_avatars}
        manage={{ token, email: sub.email, topics: normalizeTopicIds(config(), sub.topics), lang: sub.lang }}
      />
      {sub.status !== "unsubscribed" ? (
        <p className="m-0 text-sm text-muted">
          不想再收到邮件？<Link href={`/unsubscribe/${token}`}>退订</Link>
        </p>
      ) : null}
    </main>
  );
}
