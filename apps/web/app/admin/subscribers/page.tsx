import { listSubscribers, STATUS_LABELS, type SubscriberInfo } from "@xrss/core/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminLogin } from "@/components/AdminLogin";
import { AdminNav } from "@/components/AdminNav";
import { adminEnabled, isAdmin } from "@/lib/admin";
import { config, db } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "订阅者 · 精选晨报", robots: { index: false, follow: false } };

const FILTERS = [
  { id: "all", label: "全部" },
  { id: "active", label: "正常" },
  { id: "pending", label: "待确认" },
  { id: "unsubscribed", label: "已退订" },
  { id: "issues", label: "有问题" },
] as const;

const STATUS_STYLE: Record<SubscriberInfo["status"], string> = {
  active: "bg-[#E7F3EC] text-[#22663D]",
  pending: "bg-[#FDF1DE] text-[#8A5300]",
  unsubscribed: "bg-[#EEF0F2] text-[#4A5058]",
};

export default async function SubscribersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  if (!adminEnabled()) notFound();
  if (!(await isAdmin())) return <AdminLogin />;

  const { status = "all" } = await searchParams;
  const cfg = config();
  const all = await listSubscribers(await db(), cfg);
  const list = all.filter((s) => (status === "all" ? true : status === "issues" ? s.issues.length > 0 : s.status === status));
  const fmt = (d: Date | null) =>
    d ? new Intl.DateTimeFormat("zh-CN", { timeZone: cfg.digest.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "—";
  const countOf = (id: string) => (id === "all" ? all.length : id === "issues" ? all.filter((s) => s.issues.length).length : all.filter((s) => s.status === id).length);

  return (
    <main className="flex flex-col gap-6">
      <AdminNav current="subscribers" />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-3xl font-black">订阅者</h1>
          <p className="m-0 text-sm text-muted">
            共 {all.length} 位 · 正常 {countOf("active")} · 待确认 {countOf("pending")} · 已退订 {countOf("unsubscribed")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/admin/subscribers/export" className="flex min-h-9 items-center rounded-lg bg-ink px-3 text-[13px] font-bold text-white no-underline hover:text-white">
            导出 CSV
          </a>
        </div>
      </div>

      <nav aria-label="按状态筛选" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            href={f.id === "all" ? "/admin/subscribers" : `/admin/subscribers?status=${f.id}`}
            aria-current={status === f.id ? "page" : undefined}
            className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] no-underline ${
              status === f.id ? "border-ink bg-ink text-white hover:text-white" : "border-line bg-white text-body hover:text-ink"
            }`}
          >
            {f.label}
            <span className="font-mono text-xs opacity-70">{countOf(f.id)}</span>
          </Link>
        ))}
      </nav>

      <div className="overflow-x-auto rounded-[14px] border border-line bg-white">
        <table className="w-full min-w-[960px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-[#F5F6F8] text-xs text-muted">
              <th className="px-4 py-3 font-medium">邮箱</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">语言</th>
              <th className="px-4 py-3 font-medium">主题</th>
              <th className="px-4 py-3 font-medium">订阅时间</th>
              <th className="px-4 py-3 font-medium">确认时间</th>
              <th className="px-4 py-3 font-medium">最近发送</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  没有符合条件的订阅者
                </td>
              </tr>
            ) : (
              list.map((s) => (
                <tr key={s.id} className="border-b border-line align-top last:border-b-0">
                  <td className="px-4 py-3.5">
                    <div className="font-mono text-[13px] text-ink">{s.email}</div>
                    {s.issues.map((issue) => (
                      <div key={issue} className="mt-1.5 text-xs font-medium text-danger">
                        ⚠ {issue}
                      </div>
                    ))}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${STATUS_STYLE[s.status]}`}>{STATUS_LABELS[s.status]}</span>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">{s.lang === "zh" ? "中文" : "原文"}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex max-w-[340px] flex-wrap gap-1.5">
                      {s.topics.map((t) => (
                        <span key={t.id} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-xs whitespace-nowrap">
                          <span className="size-1.5 rounded-[2px]" style={{ background: t.color }} />
                          {t.name}
                        </span>
                      ))}
                      {s.invalidTopics.map((id) => (
                        <span key={id} className="rounded-md border border-dashed border-[#C9CED5] px-2 py-0.5 font-mono text-xs text-muted line-through" title="已失效的旧主题">
                          {id}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs whitespace-nowrap text-body">{fmt(s.createdAt)}</td>
                  <td className="px-4 py-3.5 font-mono text-xs whitespace-nowrap text-body">{fmt(s.confirmedAt)}</td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <div className="font-mono text-xs text-body">{s.lastSentDate ?? "—"}</div>
                    <div className="mt-1 text-xs text-muted">累计 {s.sentCount} 封</div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-xs text-muted">这个页面只有知道管理密码的人能打开，不会被搜索引擎收录。命令行里也可以用 pnpm subscribers 查看，加 --csv 导出。</p>
    </main>
  );
}
