import { subscribers } from "@xrss/core/db";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { config, db, LANG_LABEL } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function ConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const d = await db();
  const [sub] = await d.select().from(subscribers).where(eq(subscribers.token, token));
  if (!sub) {
    return (
      <Notice title="链接已失效" tone="error">
        <p className="m-0">这个确认链接无效或已被替换。可以回到首页重新订阅。</p>
      </Notice>
    );
  }
  if (sub.status !== "active") {
    await d.update(subscribers).set({ status: "active", confirmedAt: new Date(), updatedAt: new Date() }).where(eq(subscribers.id, sub.id));
  }
  const names = config()
    .topics.filter((t) => sub.topics.includes(t.id))
    .map((t) => t.name);
  return (
    <Notice title="订阅成功" tone="success">
      <p className="m-0">从明天早上 {config().digest.send_time} 起，你会收到第一封精选晨报。</p>
      <p className="m-0 text-muted">
        主题：{names.join("、")} · 语言：{LANG_LABEL[sub.lang]}
      </p>
      <p className="m-0">
        <Link href={`/preferences/${token}`}>修改设置</Link>
      </p>
    </Notice>
  );
}
