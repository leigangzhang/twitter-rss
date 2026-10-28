import { adminFeedbackCounts, listFeedback, REASON_LABELS } from "@xrss/core/db";
import { listIssues } from "@xrss/pipeline/delivery";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminLogin } from "@/components/AdminLogin";
import { AdminNav } from "@/components/AdminNav";
import { FilterChip, PageHead, Pill } from "@/components/AdminUi";
import { Pager } from "@/components/Pager";
import { adminEnabled, isAdmin } from "@/lib/admin";
import { paginate, withParam } from "@/lib/paging";
import { config, db } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "内容反馈 · 精选晨报", robots: { index: false, follow: false } };

/** 全部记录最多读这么多条，再分页显示 */
const MAX_RECORDS = 1000;
const PAGE_SIZE = 20;

/**
 * 内容反馈：管理员在邮件预览里给推文点的赞 / 踩，用来调整账号权重和精选规则。
 * 「按期」列出发过的每一期和反馈数，「全部记录」是每一条反馈。
 */
export default async function FeedbackAdminPage({ searchParams }: { searchParams: Promise<{ view?: string; vote?: string; page?: string }> }) {
  if (!adminEnabled()) notFound();
  if (!(await isAdmin())) return <AdminLogin />;

  const q = await searchParams;
  const view = q.view === "all" ? "all" : "issues";
  const vote = q.vote === "up" || q.vote === "down" ? q.vote : undefined;
  const d = await db();
  const cfg = config();
  const tz = cfg.digest.timezone;
  const counts = await adminFeedbackCounts(d);
  const total = [...counts.values()].reduce((s, c) => s + c.up + c.down, 0);
  const fmt = (x: Date) => new Intl.DateTimeFormat("zh-CN", { timeZone: tz, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(x);
  const link = (params: Record<string, string | undefined>) => withParam("/admin/feedback", params, "page", undefined);

  let body: React.ReactNode;
  if (view === "issues") {
    const page = paginate((await listIssues(d, cfg)).filter((i) => i.sent > 0), q.page, PAGE_SIZE);
    body =
      page.total === 0 ? (
        <p className="m-0 text-muted">还没有发出过邮件。</p>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-line bg-white">
          <ul className="m-0 flex list-none flex-col p-0">
            {page.rows.map((i) => {
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
          <Pager page={page} href={(n) => withParam("/admin/feedback", {}, "page", String(n), "1")} />
        </div>
      );
  } else {
    const all = await listFeedback(d, { limit: MAX_RECORDS });
    const page = paginate(vote ? all.filter((f) => f.vote === vote) : all, q.page, PAGE_SIZE);
    const up = all.filter((f) => f.vote === "up").length;
    body = (
      <>
        <nav aria-label="按评价筛选" className="flex flex-wrap gap-2">
          <FilterChip href={link({ view: "all" })} active={!vote} count={all.length}>
            全部
          </FilterChip>
          <FilterChip href={link({ view: "all", vote: "up" })} active={vote === "up"} count={up}>
            赞
          </FilterChip>
          <FilterChip href={link({ view: "all", vote: "down" })} active={vote === "down"} count={all.length - up}>
            踩
          </FilterChip>
        </nav>
        {page.total === 0 ? (
          <p className="m-0 text-muted">还没有反馈。</p>
        ) : (
          <div className="overflow-hidden rounded-[14px] border border-line bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-[#F5F6F8] text-xs text-muted">
                    <th className="px-4 py-3 font-medium">时间</th>
                    <th className="px-4 py-3 font-medium">期数</th>
                    <th className="px-4 py-3 font-medium">评价</th>
                    <th className="px-4 py-3 font-medium">推文</th>
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((f) => (
                    <tr key={f.id} className="border-b border-line align-top last:border-b-0">
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{fmt(f.updatedAt)}</td>
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{f.issueDate}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Pill tone={f.vote === "up" ? "ok" : "bad"}>{f.vote === "up" ? "赞" : "踩"}</Pill>
                        {f.reason ? <span className="ml-1.5 text-muted">{REASON_LABELS[f.reason]}</span> : null}
                        {f.note ? <div className="mt-1 max-w-[240px] text-xs whitespace-normal text-muted">{f.note}</div> : null}
                      </td>
                      <td className="px-4 py-3">
                        <a href={`https://x.com/${f.handle ?? "i"}/status/${f.tweetId}`} target="_blank" rel="noreferrer">
                          @{f.handle ?? "?"}
                        </a>{" "}
                        <span className="text-body">{f.text.replace(/\s+/g, " ").slice(0, 100)}</span>
                        {f.source !== "admin" ? <span className="ml-1.5 text-xs text-muted">（早先的读者反馈）</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} href={(n) => withParam("/admin/feedback", { view: "all", vote }, "page", String(n), "1")} />
          </div>
        )}
      </>
    );
  }

  return (
    <main className="flex flex-col gap-6">
      <AdminNav current="feedback" />
      <PageHead title="内容反馈" sub={`你在邮件预览里给推文点的赞 / 踩，用来调整账号权重和精选规则 · 共 ${total} 条`}>
        {/* 普通链接（不用 Link）：目标是一个跳转到邮件预览的接口 */}
        <a href="/admin/feedback/today" className="flex min-h-9 items-center rounded-lg bg-accent px-3.5 text-[13px] font-bold text-white no-underline hover:text-white hover:opacity-90">
          今日反馈
        </a>
      </PageHead>
      <nav aria-label="视图" className="flex gap-2">
        <FilterChip href="/admin/feedback" active={view === "issues"}>
          按期
        </FilterChip>
        <FilterChip href="/admin/feedback?view=all" active={view === "all"}>
          全部记录
        </FilterChip>
      </nav>
      {body}
    </main>
  );
}
