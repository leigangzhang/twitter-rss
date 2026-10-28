import { listSubscribers, STATUS_LABELS, type SubscriberInfo } from "@xrss/core/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminLogin } from "@/components/AdminLogin";
import { AdminNav } from "@/components/AdminNav";
import { FilterChip, PageHead, PILL } from "@/components/AdminUi";
import { Pager } from "@/components/Pager";
import { adminEnabled, isAdmin } from "@/lib/admin";
import { paginate, withParam } from "@/lib/paging";
import { config, db } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "订阅管理 · 精选晨报", robots: { index: false, follow: false } };

const FILTERS = [
  { id: "all", label: "全部" },
  { id: "active", label: "正常" },
  { id: "pending", label: "待确认" },
  { id: "unsubscribed", label: "已退订" },
  { id: "issues", label: "有问题" },
] as const;

const STATUS_STYLE: Record<SubscriberInfo["status"], string> = { active: PILL.ok, pending: PILL.warn, unsubscribed: PILL.mute };

export default async function SubscribersPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  if (!adminEnabled()) notFound();
  if (!(await isAdmin())) return <AdminLogin />;

  const { status = "all", page: pageParam } = await searchParams;
  const cfg = config();
  const all = await listSubscribers(await db(), cfg);
  const page = paginate(
    all.filter((s) => (status === "all" ? true : status === "issues" ? s.issues.length > 0 : s.status === status)),
    pageParam,
    20,
  );
  const fmt = (d: Date | null) =>
    d ? new Intl.DateTimeFormat("zh-CN", { timeZone: cfg.digest.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "—";
  const fmtShort = (d: Date) => new Intl.DateTimeFormat("zh-CN", { timeZone: cfg.digest.timezone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const countOf = (id: string) => (id === "all" ? all.length : id === "issues" ? all.filter((s) => s.issues.length).length : all.filter((s) => s.status === id).length);

  return (
    <main className="flex flex-col gap-6">
      <AdminNav current="subscribers" />
      <PageHead title="订阅管理" sub={`共 ${all.length} 位 · 正常 ${countOf("active")} · 待确认 ${countOf("pending")} · 已退订 ${countOf("unsubscribed")}`}>
        <a href="/admin/subscribers/export" className="flex min-h-9 items-center rounded-lg bg-ink px-3 text-[13px] font-bold text-white no-underline hover:text-white">
          导出 CSV
        </a>
      </PageHead>

      <nav aria-label="按状态筛选" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <FilterChip key={f.id} href={withParam("/admin/subscribers", {}, "status", f.id, "all")} active={status === f.id} count={countOf(f.id)}>
            {f.label}
          </FilterChip>
        ))}
      </nav>

      <div className="overflow-hidden rounded-[14px] border border-line bg-white">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-[#F5F6F8] text-xs text-muted">
              <th className="px-4 py-3 font-medium">邮箱</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">语言</th>
              <th className="px-4 py-3 font-medium">主题</th>
              <th className="px-4 py-3 font-medium">订阅 / 确认</th>
              <th className="px-4 py-3 font-medium">最近发送</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  没有符合条件的订阅者
                </td>
              </tr>
            ) : (
              page.rows.map((s) => (
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
                  <td className="px-4 py-3.5 font-mono text-xs whitespace-nowrap text-body">
                    {fmt(s.createdAt)}
                    <div className="mt-1 text-muted">{s.confirmedAt ? `确认 ${fmtShort(s.confirmedAt)}` : <span className="font-sans">未确认</span>}</div>
                  </td>
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
        <Pager page={page} href={(n) => withParam("/admin/subscribers", { status: status === "all" ? undefined : status }, "page", String(n), "1")} />
      </div>
    </main>
  );
}
