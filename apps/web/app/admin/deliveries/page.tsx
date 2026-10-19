import { listIssues } from "@xrss/pipeline/delivery";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminLogin } from "@/components/AdminLogin";
import { AdminNav } from "@/components/AdminNav";
import { adminEnabled, isAdmin } from "@/lib/admin";
import { config, db } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "推送历史 · 精选晨报", robots: { index: false, follow: false } };

export default async function DeliveriesPage() {
  if (!adminEnabled()) notFound();
  if (!(await isAdmin())) return <AdminLogin />;
  const cfg = config();
  const issues = await listIssues(await db(), cfg);
  const fmt = (d: Date | null) =>
    d ? new Intl.DateTimeFormat("zh-CN", { timeZone: cfg.digest.timezone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "—";

  return (
    <main className="flex flex-col gap-6">
      <AdminNav current="deliveries" />
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-3xl font-black">推送历史</h1>
        <p className="m-0 text-sm text-muted">每天一期。点开某一期可以查看收件人、发出的推文和每次发送记录，并重新推送。</p>
      </div>

      {issues.length === 0 ? (
        <p className="m-0 rounded-[14px] border border-line bg-white px-6 py-10 text-center text-sm text-muted">还没有推送记录</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {issues.map((i) => (
            <li key={i.date}>
              <Link
                href={`/admin/deliveries/${i.date}`}
                className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-[14px] border border-line bg-white px-5 py-4 text-ink no-underline hover:border-[#C9CED5] hover:text-ink"
              >
                <span className="flex min-w-[150px] flex-col gap-0.5">
                  <span className="font-mono text-base font-bold">{i.date}</span>
                  <span className="text-xs text-muted">内容 {i.periodLabel}</span>
                </span>
                <span className="flex flex-wrap gap-2 text-[13px]">
                  <span className="rounded-full bg-[#E7F3EC] px-2.5 py-0.5 font-bold text-[#22663D]">成功 {i.sent}</span>
                  {i.failed ? <span className="rounded-full bg-[#FBE9E7] px-2.5 py-0.5 font-bold text-[#A3271A]">失败 {i.failed}</span> : null}
                  {i.missing ? <span className="rounded-full bg-[#FDF1DE] px-2.5 py-0.5 font-bold text-[#8A5300]">未收到 {i.missing}</span> : null}
                </span>
                <span className="text-[13px] text-body">推文 {i.items} 条 · 发送 {i.attempts} 次</span>
                <span className="ml-auto font-mono text-xs text-muted">最近 {fmt(i.lastSentAt)} →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
