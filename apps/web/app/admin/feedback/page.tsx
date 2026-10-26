import { adminFeedbackCounts, listFeedback, REASON_LABELS } from "@xrss/core/db";
import { listIssues } from "@xrss/pipeline/delivery";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminLogin } from "@/components/AdminLogin";
import { AdminNav } from "@/components/AdminNav";
import { adminEnabled, isAdmin } from "@/lib/admin";
import { config, db } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "读者反馈 · 精选晨报", robots: { index: false, follow: false } };

/** 按期反馈列表显示最近几期 */
const RECENT_ISSUES = 14;

export default async function FeedbackAdminPage({ searchParams }: { searchParams: Promise<{ vote?: string }> }) {
  if (!adminEnabled()) notFound();
  if (!(await isAdmin())) return <AdminLogin />;

  const { vote } = await searchParams;
  const filter = vote === "up" || vote === "down" ? vote : undefined;
  const d = await db();
  const list = await listFeedback(d, { limit: 300, vote: filter });
  const issues = (await listIssues(d, config())).filter((i) => i.sent > 0).slice(0, RECENT_ISSUES);
  const counts = await adminFeedbackCounts(d);
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
        <p className="m-0 text-sm text-muted">最近 {list.length} 条；"后台"是你在推送详情的预览里点的；合并发送的邮件里的反馈不知道是谁，显示为匿名</p>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-base font-bold">按期反馈</h2>
        <p className="m-0 text-[13px] text-muted">点"去反馈"打开这一期发给你的完整邮件，在每条左下角点赞 / 踩；顶部的"今日反馈"直接打开最近一期。</p>
        {issues.length === 0 ? (
          <p className="m-0 text-muted">还没有发出过邮件。</p>
        ) : (
          <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[14px] border border-line bg-white p-0">
            {issues.map((i) => {
              const c = counts.get(i.date);
              return (
                <li key={i.date} className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-4 py-3 text-[13px] last:border-b-0">
                  <span className="min-w-[110px] font-mono font-bold">{i.date}</span>
                  <span className="text-muted">{i.items} 条</span>
                  <span className="grow">{c ? <span>赞 {c.up} · 踩 {c.down}</span> : <span className="text-muted">还没反馈</span>}</span>
                  <a href={`/admin/feedback/today?date=${i.date}`} className="flex min-h-9 items-center rounded-lg border border-line px-3 whitespace-nowrap no-underline">
                    {c ? "继续反馈" : "去反馈"}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <h2 className="m-0 text-base font-bold">全部反馈</h2>
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
                    {f.note ? <div className="mt-1 max-w-[240px] whitespace-normal text-xs text-muted">{f.note}</div> : null}
                  </td>
                  <td className="p-3">
                    <a href={`https://x.com/${f.handle ?? "i"}/status/${f.tweetId}`} target="_blank" rel="noreferrer">
                      @{f.handle ?? "?"}
                    </a>{" "}
                    <span className="text-body">{f.text.replace(/\s+/g, " ").slice(0, 80)}</span>
                  </td>
                  <td className="whitespace-nowrap p-3 text-muted">{f.source === "admin" ? "后台" : (f.email ?? "匿名")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
