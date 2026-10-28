import { addDays, localDate } from "@xrss/core";
import { feedStats } from "@xrss/core/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminLogin } from "@/components/AdminLogin";
import { AdminNav } from "@/components/AdminNav";
import { Metric, MetricGrid, PageHead, RatioBar } from "@/components/AdminUi";
import { Pager } from "@/components/Pager";
import { adminEnabled, isAdmin } from "@/lib/admin";
import { paginate, withParam } from "@/lib/paging";
import { config, db } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "RSS 订阅 · 精选晨报", robots: { index: false, follow: false } };

/** 统计最近几天 */
const DAYS = 7;
const LANGS = [
  ["zh", "中文"],
  ["orig", "原文"],
] as const;

/**
 * RSS 订阅统计：按每次抓取估算订阅人数。Feedly、Inoreader 等聚合服务按它们报告的订阅数算，
 * 其他阅读器按来源和客户端去重、每个算 1 人。记录从上线这个统计的那天开始。
 */
export default async function RssAdminPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  if (!adminEnabled()) notFound();
  if (!(await isAdmin())) return <AdminLogin />;

  const cfg = config();
  const d = await db();
  const tz = cfg.digest.timezone;
  const today = localDate(new Date(), tz);
  const to = addDays(today, 1);
  const from = addDays(to, -DAYS);
  const [now, prev] = await Promise.all([feedStats(d, from, to), feedStats(d, addDays(from, -DAYS), from)]);
  const fmt = (x: Date | null) => (x ? new Intl.DateTimeFormat("zh-CN", { timeZone: tz, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(x) : "从未");

  const feeds = cfg.topics
    .flatMap((t) => LANGS.map(([lang, label]) => ({ topic: t, lang, label, slug: `${t.id}.${lang}.xml` })))
    .map((f) => ({ ...f, stat: now.feeds.get(f.slug) }))
    .sort((a, b) => (b.stat?.readers ?? 0) - (a.stat?.readers ?? 0) || (b.stat?.hits ?? 0) - (a.stat?.hits ?? 0));
  const page = paginate(feeds, (await searchParams).page, 12);
  const active = feeds.filter((f) => f.stat?.readers).length;
  const zh = feeds.filter((f) => f.lang === "zh").reduce((s, f) => s + (f.stat?.readers ?? 0), 0);
  // 前一段时间也有完整记录时才比较
  const comparable = now.since !== null && now.since <= addDays(from, -DAYS);
  const delta = now.readers - prev.readers;
  const top = now.clients[0];
  const maxClient = Math.max(1, ...now.clients.map((c) => c.readers));

  return (
    <main className="flex flex-col gap-6">
      <AdminNav current="rss" />
      <PageHead
        title="RSS 订阅"
        sub={`${cfg.topics.length} 个主题 × 中文 / 原文，共 ${feeds.length} 个订阅地址。订阅人数是估算：Feedly、Inoreader 等聚合服务按它们报告的订阅数算，其他阅读器按来源和客户端去重。`}
      />
      {now.since === null ? (
        <p className="m-0 rounded-[10px] bg-accent-soft px-4 py-3 text-[13px] text-accent-strong">还没有抓取记录。从这个版本上线起，每次有阅读器抓取订阅地址都会记一笔，一般一天内就会有数据。</p>
      ) : now.since > from ? (
        <p className="m-0 text-[13px] text-muted">记录从 {now.since} 开始，不满 {DAYS} 天。</p>
      ) : null}

      <MetricGrid>
        <Metric label="估算订阅人数" value={now.readers} foot={`近 ${DAYS} 天${comparable ? ` · 比前 ${DAYS} 天 ${delta >= 0 ? "+" : ""}${delta}` : ""}`} />
        <Metric
          label="有人订阅的地址"
          value={
            <>
              {active}
              <span className="ml-1 font-sans text-[13px] font-normal text-muted">/ {feeds.length}</span>
            </>
          }
          foot={`中文 ${zh} 人 · 原文 ${now.readers - zh} 人`}
        />
        <Metric label={`近 ${DAYS} 天抓取`} value={now.hits.toLocaleString("zh-CN")} foot={`日均 ${Math.round(now.hits / DAYS)} 次`} />
        <Metric label="最常用的阅读器" value={<span className="font-sans text-xl">{top?.client ?? "—"}</span>} foot={top ? `${top.readers} 人，占 ${Math.round((top.readers / Math.max(1, now.readers)) * 100)}%` : "还没有数据"} />
      </MetricGrid>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-base font-bold">各订阅地址</h2>
        <div className="overflow-hidden rounded-[14px] border border-line bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-line bg-[#F5F6F8] text-xs text-muted">
                  <th className="px-4 py-3 font-medium">主题</th>
                  <th className="px-4 py-3 font-medium">语言</th>
                  <th className="px-4 py-3 font-medium">地址</th>
                  <th className="px-4 py-3 text-right font-medium">估算订阅</th>
                  <th className="px-4 py-3 text-right font-medium">近 {DAYS} 天抓取</th>
                  <th className="px-4 py-3 font-medium">最近一次抓取</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((f) => (
                  <tr key={f.slug} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-xs whitespace-nowrap">
                        <span className="size-1.5 rounded-[2px]" style={{ background: f.topic.color }} />
                        {f.topic.name}
                      </span>
                    </td>
                    <td className="px-4 py-3">{f.label}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      <a href={`/feed/${f.slug}`} target="_blank" rel="noreferrer" className="text-muted">
                        /feed/{f.slug}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold">{f.stat?.readers ?? <span className="font-normal text-muted">0</span>}</td>
                    <td className="px-4 py-3 text-right font-mono">{f.stat?.hits ?? 0}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{fmt(f.stat?.lastAt ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} href={(n) => withParam("/admin/rss", {}, "page", String(n), "1")} />
        </div>
      </section>

      {now.clients.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="m-0 text-base font-bold">
            阅读器 <span className="text-xs font-normal text-muted">近 {DAYS} 天，按估算订阅人数</span>
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2.5 rounded-[14px] border border-line bg-white p-4">
            {now.clients.map((c) => (
              <li key={c.client} className="grid grid-cols-[140px_minmax(0,1fr)_40px] items-center gap-3 text-[13px]">
                <span>
                  <b>{c.client}</b>
                  <div className="text-[11px] text-muted">{c.aggregator ? "聚合服务，报告订阅数" : "按来源 + 客户端估算"}</div>
                </span>
                <RatioBar parts={[[c.readers, "#1F5FD6"], [maxClient - c.readers, "transparent"]]} />
                <span className="text-right font-mono">{c.readers}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
