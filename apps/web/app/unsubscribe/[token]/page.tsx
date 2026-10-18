import { subscribers } from "@xrss/core/db";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { db } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const [sub] = await (await db()).select().from(subscribers).where(eq(subscribers.token, token));
  if (!sub) {
    return (
      <Notice title="链接已失效" tone="error">
        <p className="m-0">请使用最近一封邮件底部的退订链接。</p>
      </Notice>
    );
  }
  if (done || sub.status === "unsubscribed") {
    return (
      <Notice title="已退订">
        <p className="m-0">{sub.email} 不会再收到精选晨报。</p>
        <p className="m-0">
          改主意了？<Link href={`/preferences/${token}`}>重新订阅</Link>
        </p>
      </Notice>
    );
  }
  return (
    <Notice title="确认退订？">
      <p className="m-0">退订后，{sub.email} 将不再收到每日邮件。</p>
      <p className="m-0 text-muted">
        如果只是内容太多或语言不合适，也可以<Link href={`/preferences/${token}`}>调整主题和语言</Link>。
      </p>
      <form method="post" action={`/api/unsubscribe/${token}`}>
        <button type="submit" className="mt-2 h-12 cursor-pointer rounded-[10px] bg-ink px-6 text-[15px] font-bold text-white">
          确认退订
        </button>
      </form>
    </Notice>
  );
}
