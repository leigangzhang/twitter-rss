import { listIssues } from "@xrss/pipeline/delivery";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminLogin } from "@/components/AdminLogin";
import { AdminNav } from "@/components/AdminNav";
import { PageHead, Pill } from "@/components/AdminUi";
import { Pager } from "@/components/Pager";
import { adminEnabled, isAdmin } from "@/lib/admin";
import { paginate, withParam } from "@/lib/paging";
import { config, db } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "邮件推送 · 精选晨报", robots: { index: false, follow: false } };

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  if (!adminEnabled()) notFound();
  if (!(await isAdmin())) return <AdminLogin />;
  const cfg = config();
  const issues = await listIssues(await db(), cfg);
  const page = paginate(issues, (await searchParams).page, 20);
  const fmt = (d: Date | null) =>
    d ? new Intl.DateTimeFormat("zh-CN", { timeZone: cfg.digest.timezone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "—";

  return (
    <main className="flex flex-col gap-6">
      <AdminNav current="deliveries" />
      <PageHead title="邮件推送" sub="每天一期。点开一期看收件人、推文和发送记录，可以重新推送。" />

      {issues.length === 0 ? (
        <p className="m-0 rounded-[14px] border border-line bg-white px-6 py-10 text-center text-sm text-muted">还没有推送记录</p>
      ) : (
        <div className="flex flex-col gap-3">
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {page.rows.map((i) => (
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
                  <Pill tone="ok">成功 {i.sent}</Pill>
                  {i.failed ? <Pill tone="bad">失败 {i.failed}</Pill> : null}
                  {i.missing ? <Pill tone="warn">未收到 {i.missing}</Pill> : null}
                </span>
                <span className="text-[13px] text-body">推文 {i.items} 条 · 发送 {i.attempts} 次</span>
                <span className="ml-auto font-mono text-xs text-muted">最近 {fmt(i.lastSentAt)} →</span>
              </Link>
            </li>
          ))}
        </ul>
        {page.pages > 1 ? (
          <div className="overflow-hidden rounded-[14px] border border-line bg-white [&>nav]:border-t-0">
            <Pager page={page} href={(n) => withParam("/admin/deliveries", {}, "page", String(n), "1")} />
          </div>
        ) : null}
        </div>
      )}
    </main>
  );
}
