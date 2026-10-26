import { listFeedback, REASON_LABELS } from "@xrss/core/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminLogin } from "@/components/AdminLogin";
import { AdminNav } from "@/components/AdminNav";
import { adminEnabled, isAdmin } from "@/lib/admin";
import { config, db } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "读者反馈 · 精选晨报", robots: { index: false, follow: false } };

export default async function FeedbackAdminPage({ searchParams }: { searchParams: Promise<{ vote?: string }> }) {
  if (!adminEnabled()) notFound();
  if (!(await isAdmin())) return <AdminLogin />;

  const { vote } = await searchParams;
  const filter = vote === "up" || vote === "down" ? vote : undefined;
  const list = await listFeedback(await db(), { limit: 300, vote: filter });
  const tz = config().digest.timezone;
  const fmt = (d: Date) => new Intl.DateTimeFormat("zh-CN", { timeZone: tz, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const tabs = [
    { id: undefined, label: "全部" },
    { id: "up", label: "👍" },
    { id: "down", label: "👎" },
  ] as const;

  return (
    <main className="flex flex-col gap-6">
      <AdminNav current="feedback" />
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-3xl font-black">读者反馈</h1>
        <p className="m-0 text-sm text-muted">最近 {list.length} 条；合并发送的邮件里的反馈不知道是谁，显示为匿名</p>
      </div>
      <nav aria-label="按评价筛选" className="flex gap-2">
        {tabs.map((t) => (
          <Link
            key={t.label}
            href={t.id ? `/admin/feedback?vote=${t.id}` : "/admin/feedback"}
            aria-current={filter === t.id ? "page" : undefined}
            className={`flex min-h-9 items-center rounded-lg px-3 text-[13px] no-underline ${filter === t.id ? "bg-ink font-bold text-white hover:text-white" : "border border-line text-body"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {list.length === 0 ? (
        <p className="m-0 text-muted">还没有反馈。</p>
      ) : (
        <div className="overflow-x-auto rounded-[14px] border border-line bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="p-3 font-normal">时间</th>
                <th className="p-3 font-normal">期数</th>
                <th className="p-3 font-normal">评价</th>
                <th className="p-3 font-normal">推文</th>
                <th className="p-3 font-normal">读者</th>
              </tr>
            </thead>
            <tbody>
              {list.map((f) => (
                <tr key={f.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap p-3">{fmt(f.updatedAt)}</td>
                  <td className="whitespace-nowrap p-3">{f.issueDate}</td>
                  <td className="whitespace-nowrap p-3">
                    {f.vote === "up" ? "👍" : "👎"}
                    {f.reason ? <span className="ml-1 text-muted">{REASON_LABELS[f.reason]}</span> : null}
                  </td>
                  <td className="p-3">
                    <a href={`https://x.com/${f.handle ?? "i"}/status/${f.tweetId}`} target="_blank" rel="noreferrer">
                      @{f.handle ?? "?"}
                    </a>{" "}
                    <span className="text-body">{f.text.replace(/\s+/g, " ").slice(0, 80)}</span>
                  </td>
                  <td className="whitespace-nowrap p-3 text-muted">{f.email ?? "匿名"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
