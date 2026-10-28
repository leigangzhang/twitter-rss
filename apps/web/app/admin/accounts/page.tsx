import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accountWeight, readAccountWeights } from "@xrss/core";
import { accounts, feedbackByHandle } from "@xrss/core/db";
import { loadSyncState, runningSync, SYNC_STEP_LABELS, SYNC_STEPS, syncLogTail } from "@xrss/collector/follows";
import { type AccountQuality, type AccountTier, budgetWarning, loadAccountQuality, TIER_LABELS } from "@xrss/collector/quality";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AddAccountDialog, RemoveAccountButton, RemoveFromTopicButton, SyncFollowsButton, SyncFollowsCard, SyncFollowsDialog, TopicFilter, WeightEditor } from "@/components/AccountControls";
import { AdminLogin } from "@/components/AdminLogin";
import { AdminNav } from "@/components/AdminNav";
import { CARD, FilterChip, Metric, MetricGrid, PageHead, RatioBar, TABLE, THEAD_ROW } from "@/components/AdminUi";
import { Pager } from "@/components/Pager";
import { adminEnabled, isAdmin } from "@/lib/admin";
import { paginate, withParam } from "@/lib/paging";
import { config, db } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "账号管理 · 精选晨报", robots: { index: false, follow: false } };

const TIER_ORDER: AccountTier[] = ["good", "normal", "unrated", "poor", "inactive"];
const TIER_STYLE: Record<AccountTier, string> = {
  good: "bg-[#E7F3EC] text-[#22663D]",
  normal: "bg-[#EEF3FC] text-[#1F4FA8]",
  unrated: "bg-[#EEF0F2] text-[#4A5058]",
  poor: "bg-[#FDF1DE] text-[#8A5300]",
  inactive: "bg-[#EEF0F2] text-[#6B7178]",
};

const TIER_COLOR: Record<AccountTier, string> = { good: "#2F7D4F", normal: "#1F5FD6", unrated: "#C9CED5", poor: "#D08A1E", inactive: "#9AA0A8" };
const PAGE_SIZE = 20;

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ tier?: string; topic?: string; flag?: string; page?: string }> }) {
  if (!adminEnabled()) notFound();
  if (!(await isAdmin())) return <AdminLogin />;

  const params = await searchParams;
  const { tier = "all", topic, flag } = params;
  const cfg = config();
  const d = await db();
  const quality = await loadAccountQuality(d, cfg);
  const profiles = new Map((await d.select({ handle: accounts.handle, name: accounts.name, avatarUrl: accounts.avatarUrl, lastCollectedAt: accounts.lastCollectedAt }).from(accounts)).map((a) => [a.handle.toLowerCase(), a]));
  const votes = await feedbackByHandle(d);
  const notes = readAccountWeights(readFileSync(join(cfg.configDir, "digest.yaml"), "utf8"));
  const topicById = new Map(cfg.topics.map((t) => [t.id, t]));
  const q = cfg.crawl.account_quality;
  const tz = cfg.digest.timezone;
  const fs = cfg.crawl.follow_sync;
  const sync = loadSyncState();
  const progress = runningSync(sync);
  const unfollowed = new Set(sync.unfollowed.filter((h) => cfg.accountTopics.has(h)));
  const warning = budgetWarning([...quality.values()].map((a) => a.tier), cfg);
  const fmt = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("zh-CN", { timeZone: tz, month: "2-digit", day: "2-digit" }).format(d) : "—");

  const all = [...quality.values()].sort(
    (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || (b.keepRate ?? -1) - (a.keepRate ?? -1) || b.reviewed - a.reviewed || a.handle.localeCompare(b.handle),
  );
  const weightOf = (a: AccountQuality) => accountWeight(cfg.digest.account_weight, a.handle);
  const matchTier = (a: AccountQuality, id: string) => id === "all" || a.tier === id;
  const matchFlag = (a: AccountQuality, id: string | undefined) => !id || (id === "remove" ? a.suggestRemove : id === "unfollowed" ? unfollowed.has(a.handle) : id === "weighted" ? weightOf(a) !== 1 : true);
  const inTopic = (a: AccountQuality) => !topic || (cfg.accountTopics.get(a.handle) ?? []).includes(topic);
  const page = paginate(
    all.filter((a) => matchTier(a, tier) && matchFlag(a, flag) && inTopic(a)),
    params.page,
    PAGE_SIZE,
  );
  const countOf = (fn: (a: AccountQuality) => boolean) => all.filter((a) => fn(a) && inTopic(a)).length;
  // 改筛选时回到第一页
  const base = { tier: tier === "all" ? undefined : tier, topic, flag };
  const href = (key: "tier" | "topic" | "flag", value: string | undefined) => withParam("/admin/accounts", key === "tier" ? { ...base, flag: undefined } : key === "flag" ? { ...base, tier: undefined } : base, key, value, "all");

  const reviewed = all.reduce((s, a) => s + a.reviewed, 0);
  const kept = all.reduce((s, a) => s + a.kept, 0);
  const tierCount = (t: AccountTier) => all.filter((a) => a.tier === t).length;
  const removeCount = all.filter((a) => a.suggestRemove).length;

  return (
    <main className="flex flex-col gap-6">
      <AdminNav current="accounts" />
      <PageHead
        title="账号管理"
        sub={
          <details className="group">
            <summary className="cursor-pointer list-none">
              按近 {q.stats_days} 天 AI 初审的保留率分档，档位决定多久采一次 <span className="text-accent group-open:hidden">· 规则</span>
            </summary>
            <p className="mt-2 mb-0 max-w-[760px] rounded-lg bg-note px-3 py-2.5 text-xs leading-relaxed">
              优质每 {q.interval_hours.good} 小时、普通每 {q.interval_hours.normal} 小时、低质和不活跃每 {q.interval_hours.poor} 小时采集一次；评审少于 {q.min_samples} 条为样本不足。⚠ = 评审 ≥{" "}
              {q.suggest_remove.min_samples} 条且保留率 &lt; {pct(q.suggest_remove.max_keep_rate)}，建议移出。添加、移出改 config/topics.yaml，权重改 config/digest.yaml（原因写成行尾注释），下次运行生效；只有一个账号的主题不能再移出。
            </p>
          </details>
        }
      >
        <SyncFollowsButton />
        <AddAccountDialog topics={cfg.topics.map((t) => ({ id: t.id, name: t.name }))} />
      </PageHead>

      <MetricGrid>
        <Metric label="采集账号" value={all.length} foot={TIER_ORDER.map((t) => `${TIER_LABELS[t]} ${tierCount(t)}`).join(" · ")}>
          <RatioBar parts={TIER_ORDER.map((t) => [tierCount(t), TIER_COLOR[t]])} />
        </Metric>
        <Metric label={`近 ${q.stats_days} 天保留率`} aside={<span className="font-mono">{kept} / {reviewed} 条</span>} value={pct(reviewed ? kept / reviewed : null)} foot="AI 初审通过的比例">
          <RatioBar parts={[[kept, "#2F7D4F"], [reviewed - kept, "#E3E6EA"]]} />
        </Metric>
        <Metric
          label="需要处理"
          value={
            <>
              {removeCount + unfollowed.size}
              <span className="ml-1 font-sans text-[13px] font-normal text-muted">个账号</span>
            </>
          }
          foot={
            <>
              <a href={href("flag", "remove")}>建议移出 {removeCount}</a> · <a href={href("flag", "unfollowed")}>已取关 {unfollowed.size}</a>
            </>
          }
        />
        <SyncFollowsCard last={sync.last ?? null} running={Boolean(progress)} />
      </MetricGrid>

      {warning ? <p className="m-0 rounded-[10px] border border-[#F0C987] bg-[#FDF1DE] px-4 py-3 text-[13px] text-[#8A5300]">⚠ {warning}</p> : null}

      <nav aria-label="筛选" className="flex flex-wrap items-center gap-2">
        {["all", ...TIER_ORDER].map((t) => (
          <FilterChip key={t} href={href("tier", t)} active={tier === t && !flag} count={countOf((a) => matchTier(a, t))}>
            {t === "all" ? "全部" : TIER_LABELS[t as AccountTier]}
          </FilterChip>
        ))}
        <FilterChip href={href("flag", flag === "remove" ? undefined : "remove")} active={flag === "remove"} count={countOf((a) => a.suggestRemove)}>
          ⚠ 建议移出
        </FilterChip>
        <FilterChip href={href("flag", flag === "unfollowed" ? undefined : "unfollowed")} active={flag === "unfollowed"} count={countOf((a) => unfollowed.has(a.handle))}>
          已取关
        </FilterChip>
        <FilterChip href={href("flag", flag === "weighted" ? undefined : "weighted")} active={flag === "weighted"} count={countOf((a) => weightOf(a) !== 1)}>
          调过权重
        </FilterChip>
        <TopicFilter
          topics={cfg.topics.map((t) => ({ id: t.id, name: t.name }))}
          value={topic}
          hrefs={Object.fromEntries([["", href("topic", undefined)], ...cfg.topics.map((t) => [t.id, href("topic", t.id)])])}
        />
      </nav>

      <div className={CARD}>
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[1000px]`}>
            <thead>
              <tr className={THEAD_ROW}>
                <th className="px-4 py-3 font-medium">账号</th>
                <th className="px-4 py-3 font-medium">主题</th>
                <th className="px-4 py-3 font-medium">档位</th>
                <th className="px-3 py-3 font-medium" title={`近 ${q.stats_days} 天：保留 / AI 初审过的推文数`}>
                  保留率
                </th>
                <th className="px-3 py-3 text-right font-medium" title="评审过的推文平均分（5 分制）">
                  平均分
                </th>
                <th className="px-3 py-3 font-medium">最近发推 / 采集</th>
                <th className="px-3 py-3 font-medium" title="后台预览里的赞 / 踩（累计）">
                  赞 / 踩
                </th>
                <th className="px-3 py-3 font-medium" title="config/digest.yaml 的 account_weight">
                  权重
                </th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted">
                    没有符合条件的账号
                  </td>
                </tr>
              ) : (
                page.rows.map((a) => {
                  const p = profiles.get(a.handle);
                  const topics = cfg.accountTopics.get(a.handle) ?? [];
                  const v = votes.get(a.handle);
                  return (
                    <tr key={a.handle} className="border-b border-line align-top last:border-b-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {p?.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.avatarUrl} alt="" width={28} height={28} className="size-7 rounded-full bg-note" />
                          ) : (
                            <span className="size-7 rounded-full bg-note" />
                          )}
                          <div className="flex flex-col">
                            <a href={`https://x.com/${a.handle}`} target="_blank" rel="noreferrer" className="font-mono text-[13px] no-underline">
                              @{a.handle}
                            </a>
                            {p?.name ? <span className="text-xs text-muted">{p.name}</span> : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex max-w-[220px] flex-wrap gap-1.5">
                          {topics.map((id) => {
                            const t = topicById.get(id)!;
                            return (
                              <span key={id} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-xs whitespace-nowrap">
                                <span className="size-1.5 rounded-[2px]" style={{ background: t.color }} />
                                {t.name}
                                {topics.length > 1 ? <RemoveFromTopicButton handle={a.handle} topicId={id} topicName={t.name} /> : null}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${TIER_STYLE[a.tier]}`}>{TIER_LABELS[a.tier]}</span>
                        {a.suggestRemove ? (
                          <span className="ml-1.5 text-xs font-bold text-danger" title="长期低质，建议移出">
                            ⚠
                          </span>
                        ) : null}
                        {unfollowed.has(a.handle) ? <span className="ml-1.5 rounded-full bg-[#EEF0F2] px-2 py-0.5 text-xs text-[#4A5058]">已取关</span> : null}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <b className="font-mono">{pct(a.keepRate)}</b> <span className="font-mono text-xs text-muted">{a.kept}/{a.reviewed}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono">{a.avgQuality ?? "—"}</td>
                      <td className="px-3 py-3 font-mono text-xs whitespace-nowrap text-body">
                        {fmt(a.lastTweetAt)}
                        <div className="text-muted">{p?.lastCollectedAt ? `采 ${fmt(p.lastCollectedAt)}` : <span className="font-sans">还没采过</span>}</div>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">{v ? `${v.up} / ${v.down}` : <span className="text-muted">—</span>}</td>
                      <td className="px-3 py-3">
                        <WeightEditor handle={a.handle} weight={weightOf(a)} note={notes.get(a.handle)?.note} />
                      </td>
                      <td className="px-4 py-3">
                        <RemoveAccountButton handle={a.handle} label="移出" confirmLabel={topics.length > 1 ? `从 ${topics.length} 个主题移出` : "确认移出"} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pager page={page} href={(n) => withParam("/admin/accounts", { ...base }, "page", String(n), "1")} />
      </div>

      <SyncFollowsDialog
        steps={SYNC_STEPS.map((id) => ({ id, label: id === "write" ? `写进主题「${fs.topic.name}」` : SYNC_STEP_LABELS[id] }))}
        auto={fs.enabled ? `已打开：每日任务每 ${fs.every_days} 天同步一次${fs.handle ? `（@${fs.handle}）` : ""}` : "没有打开。在 config/crawl.yaml 把 follow_sync.enabled 改成 true 后，每日任务会按间隔自动同步"}
        unfollowed={[...unfollowed]}
        initial={{ last: sync.last ?? null, progress: progress ?? null, log: sync.last && !sync.last.ok ? syncLogTail(20) : [] }}
      />
    </main>
  );
}
