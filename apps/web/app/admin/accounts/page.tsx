import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accountWeight, readAccountWeights } from "@xrss/core";
import { accounts, feedbackByHandle } from "@xrss/core/db";
import { loadSyncState, lockHolder } from "@xrss/collector/follows";
import { type AccountQuality, type AccountTier, budgetWarning, loadAccountQuality, TIER_LABELS } from "@xrss/collector/quality";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddAccountForm, RemoveAccountButton, RemoveFromTopicButton, SyncFollowsButton, WeightEditor } from "@/components/AccountControls";
import { AdminLogin } from "@/components/AdminLogin";
import { AdminNav } from "@/components/AdminNav";
import { adminEnabled, isAdmin } from "@/lib/admin";
import { config, db } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "账号 · 精选晨报", robots: { index: false, follow: false } };

const TIER_ORDER: AccountTier[] = ["good", "normal", "unrated", "poor", "inactive"];
const TIER_STYLE: Record<AccountTier, string> = {
  good: "bg-[#E7F3EC] text-[#22663D]",
  normal: "bg-[#EEF3FC] text-[#1F4FA8]",
  unrated: "bg-[#EEF0F2] text-[#4A5058]",
  poor: "bg-[#FDF1DE] text-[#8A5300]",
  inactive: "bg-[#EEF0F2] text-[#6B7178]",
};

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ tier?: string; topic?: string }> }) {
  if (!adminEnabled()) notFound();
  if (!(await isAdmin())) return <AdminLogin />;

  const { tier = "all", topic } = await searchParams;
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
  const syncing = lockHolder()?.what === "同步关注";
  const unfollowed = sync.unfollowed.filter((h) => cfg.accountTopics.has(h));
  const warning = budgetWarning([...quality.values()].map((a) => a.tier), cfg);
  const fmtTime = (iso: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: tz, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  const fmt = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("zh-CN", { timeZone: tz, month: "2-digit", day: "2-digit" }).format(d) : "—");

  const all = [...quality.values()].sort(
    (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || (b.keepRate ?? -1) - (a.keepRate ?? -1) || b.reviewed - a.reviewed || a.handle.localeCompare(b.handle),
  );
  const weightOf = (a: AccountQuality) => accountWeight(cfg.digest.account_weight, a.handle);
  const matchTier = (a: AccountQuality, id: string) => (id === "all" ? true : id === "remove" ? a.suggestRemove : id === "weighted" ? weightOf(a) !== 1 : a.tier === id);
  const inTopic = (a: AccountQuality) => !topic || (cfg.accountTopics.get(a.handle) ?? []).includes(topic);
  const list = all.filter((a) => matchTier(a, tier) && inTopic(a));

  const filters = [
    { id: "all", label: "全部" },
    ...TIER_ORDER.map((t) => ({ id: t, label: TIER_LABELS[t] })),
    { id: "remove", label: "⚠ 建议移出" },
    { id: "weighted", label: "调过权重" },
  ];
  const countOf = (id: string) => all.filter((a) => matchTier(a, id) && inTopic(a)).length;
  const href = (params: { tier?: string; topic?: string }) => {
    const s = new URLSearchParams();
    const t = params.tier ?? tier;
    const tp = "topic" in params ? params.topic : topic;
    if (t !== "all") s.set("tier", t);
    if (tp) s.set("topic", tp);
    const qs = s.toString();
    return qs ? `/admin/accounts?${qs}` : "/admin/accounts";
  };

  return (
    <main className="flex flex-col gap-6">
      <AdminNav current="accounts" />
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-3xl font-black">账号</h1>
        <p className="m-0 text-sm text-muted">
          共 {all.length} 个账号 · {TIER_ORDER.map((t) => `${TIER_LABELS[t]} ${all.filter((a) => a.tier === t).length}`).join(" · ")}
        </p>
        <p className="m-0 text-[13px] text-muted">
          按近 {q.stats_days} 天 AI 初审的保留率分档：优质每 {q.interval_hours.good} 小时、普通每 {q.interval_hours.normal} 小时、低质和不活跃每 {q.interval_hours.poor} 小时采集一次；评审少于{" "}
          {q.min_samples} 条为样本不足。⚠ = 评审 ≥ {q.suggest_remove.min_samples} 条且保留率 &lt; {pct(q.suggest_remove.max_keep_rate)}，建议移出。
        </p>
      </div>

      {warning ? <p className="m-0 rounded-[10px] border border-[#F0C987] bg-[#FDF1DE] px-4 py-3 text-[13px] text-[#8A5300]">⚠ {warning}</p> : null}

      <section className="flex flex-col gap-2 rounded-[14px] border border-line bg-white p-4">
        <h2 className="m-0 text-base font-bold">新增账号</h2>
        <p className="m-0 text-[13px] text-muted">写进 config/topics.yaml，下次生成采集清单时开始采集。同一账号可以加到多个主题；账号不存在时采集会跳过并提醒。</p>
        <AddAccountForm topics={cfg.topics.map((t) => ({ id: t.id, name: t.name }))} />
      </section>

      <section className="flex flex-col gap-2 rounded-[14px] border border-line bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-base font-bold">同步 X 关注</h2>
            <p className="m-0 text-[13px] text-muted">
              读取{fs.handle ? ` @${fs.handle} ` : "采集 Chrome 里登录的账号"}的"正在关注"列表，把名单里还没有的账号加进主题「{fs.topic.name}」。只滚动读取，冷却期内不运行，遇到限流就停止并冷却。
              {fs.enabled ? `每日任务每 ${fs.every_days} 天自动同步一次。` : "自动同步没有打开（crawl.yaml 的 follow_sync.enabled）。"}
            </p>
          </div>
          <SyncFollowsButton running={syncing} />
        </div>
        {sync.last ? (
          <p className={`m-0 text-[13px] ${sync.last.ok ? "text-body" : "text-danger"}`}>
            <span className="font-mono text-xs text-muted">{fmtTime(sync.last.at)}</span> {sync.last.message}
          </p>
        ) : (
          <p className="m-0 text-[13px] text-muted">还没有同步过。</p>
        )}
        {unfollowed.length ? (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <p className="m-0 text-[13px]">已经取关、但还在名单里的同步账号（移出后不会再同步回来）：</p>
            <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
              {unfollowed.map((h) => (
                <li key={h} className="flex items-center gap-2 text-[13px]">
                  <span className="font-mono">@{h}</span>
                  <RemoveAccountButton handle={h} label="移出" confirmLabel="确认移出" />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="flex flex-col gap-2">
        <nav aria-label="按档位筛选" className="flex flex-wrap gap-2">
          {filters.map((f) => (
            <Link
              key={f.id}
              href={href({ tier: f.id })}
              aria-current={tier === f.id ? "page" : undefined}
              className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] no-underline ${
                tier === f.id ? "border-ink bg-ink text-white hover:text-white" : "border-line bg-white text-body hover:text-ink"
              }`}
            >
              {f.label}
              <span className="font-mono text-xs opacity-70">{countOf(f.id)}</span>
            </Link>
          ))}
        </nav>
        <nav aria-label="按主题筛选" className="flex flex-wrap gap-2">
          {[{ id: undefined, name: "所有主题", color: undefined }, ...cfg.topics].map((t) => (
            <Link
              key={t.id ?? "all"}
              href={href({ topic: t.id })}
              aria-current={topic === t.id ? "page" : undefined}
              className={`flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs no-underline ${topic === t.id ? "border-ink text-ink font-bold" : "border-line bg-white text-body hover:text-ink"}`}
            >
              {t.color ? <span className="size-1.5 rounded-[2px]" style={{ background: t.color }} /> : null}
              {t.name}
            </Link>
          ))}
        </nav>
      </div>

      <div className="overflow-x-auto rounded-[14px] border border-line bg-white">
        <table className="w-full min-w-[1080px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-[#F5F6F8] text-xs text-muted">
              <th className="px-4 py-3 font-medium">账号</th>
              <th className="px-4 py-3 font-medium">主题</th>
              <th className="px-4 py-3 font-medium">档位</th>
              <th className="px-3 py-3 text-right font-medium" title={`近 ${q.stats_days} 天 AI 初审过的推文数`}>
                评审
              </th>
              <th className="px-3 py-3 text-right font-medium">保留</th>
              <th className="px-3 py-3 text-right font-medium">保留率</th>
              <th className="px-3 py-3 text-right font-medium" title="评审过的推文平均分（5 分制）">
                平均分
              </th>
              <th className="px-3 py-3 font-medium">最近发推</th>
              <th className="px-3 py-3 font-medium">上次采集</th>
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
            {list.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-muted">
                  没有符合条件的账号
                </td>
              </tr>
            ) : (
              list.map((a) => {
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
                    </td>
                    <td className="px-3 py-3 text-right font-mono">{a.reviewed}</td>
                    <td className="px-3 py-3 text-right font-mono">{a.kept}</td>
                    <td className="px-3 py-3 text-right font-mono font-bold">{pct(a.keepRate)}</td>
                    <td className="px-3 py-3 text-right font-mono">{a.avgQuality ?? "—"}</td>
                    <td className="px-3 py-3 font-mono text-xs whitespace-nowrap text-body">{fmt(a.lastTweetAt)}</td>
                    <td className="px-3 py-3 font-mono text-xs whitespace-nowrap text-body">{p ? fmt(p.lastCollectedAt) : <span className="font-sans text-muted">还没采过</span>}</td>
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
      <p className="m-0 text-xs text-muted">
        新增、移出账号改的是 config/topics.yaml，权重改的是 config/digest.yaml（原因写成行尾注释），下次运行生效；只有一个账号的主题不能再移出。命令行里也可以用 pnpm accounts 查看质量表。
      </p>
    </main>
  );
}
