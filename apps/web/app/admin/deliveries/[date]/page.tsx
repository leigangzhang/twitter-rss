import { issueDetail, KIND_LABELS } from "@xrss/pipeline/delivery";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminLogin } from "@/components/AdminLogin";
import { AdminNav } from "@/components/AdminNav";
import { ResendButton } from "@/components/ResendButton";
import { adminEnabled, isAdmin } from "@/lib/admin";
import { config, db, getDigestMailer } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "推送详情 · 精选晨报", robots: { index: false, follow: false } };

const STATUS = {
  sent: { label: "成功", style: "bg-[#E7F3EC] text-[#22663D]" },
  failed: { label: "失败", style: "bg-[#FBE9E7] text-[#A3271A]" },
  missing: { label: "未收到", style: "bg-[#FDF1DE] text-[#8A5300]" },
} as const;

export default async function DeliveryDetailPage({ params }: { params: Promise<{ date: string }> }) {
  if (!adminEnabled()) notFound();
  if (!(await isAdmin())) return <AdminLogin />;
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const cfg = config();
  const d = await issueDetail(await db(), cfg, date);
  if (!d) notFound();
  const canSend = getDigestMailer() !== null;
  const fmt = (x: Date | null) =>
    x ? new Intl.DateTimeFormat("zh-CN", { timeZone: cfg.digest.timezone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(x) : "—";

  return (
    <main className="flex flex-col gap-8">
      <AdminNav current="deliveries" />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Link href="/admin/deliveries" className="text-sm">
            ← 推送历史
          </Link>
          <h1 className="m-0 font-mono text-3xl font-black">{d.date}</h1>
          <p className="m-0 text-sm text-muted">
            内容 {d.periodLabel} · 成功 {d.sent} · 失败 {d.failed} · 未收到 {d.missing} · 推文 {d.items} 条 · 发送 {d.attempts} 次
          </p>
        </div>
        {canSend ? (
          <div className="flex flex-wrap items-start gap-2">
            {d.failed ? <ResendButton date={d.date} action="retry" label={`重试失败的（${d.failed}）`} confirmLabel={`确认重试 ${d.failed} 位`} variant="primary" /> : null}
            {d.missing ? <ResendButton date={d.date} action="missing" label={`补发给未收到的（${d.missing}）`} confirmLabel={`确认补发 ${d.missing} 位`} variant="primary" /> : null}
          </div>
        ) : (
          <p className="m-0 text-[13px] text-danger">没有配置 SMTP_USER / SMTP_PASS，只能查看，不能发送</p>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-base font-bold">收件人</h2>
        <div className="overflow-x-auto rounded-[14px] border border-line bg-white">
          <table className="w-full min-w-[820px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-[#F5F6F8] text-xs text-muted">
                <th className="px-4 py-3 font-medium">邮箱</th>
                <th className="px-4 py-3 font-medium">结果</th>
                <th className="px-4 py-3 font-medium">发送时间</th>
                <th className="px-4 py-3 font-medium">推文</th>
                <th className="px-4 py-3 font-medium">发送次数</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {d.recipients.map((r) => (
                <tr key={r.subscriber.id} className="border-b border-line align-top last:border-b-0">
                  <td className="px-4 py-3.5">
                    <div className="font-mono text-ink">{r.subscriber.email}</div>
                    <div className="mt-1 text-xs text-muted">
                      {r.subscriber.lang === "zh" ? "中文" : "原文"}
                      {r.subscriber.status !== "active" ? ` · ${r.subscriber.status === "unsubscribed" ? "已退订" : "待确认"}` : ""}
                    </div>
                    {r.error ? <div className="mt-1.5 max-w-[320px] text-xs text-danger">{r.error}</div> : null}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${STATUS[r.status].style}`}>{STATUS[r.status].label}</span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs whitespace-nowrap text-body">{fmt(r.sentAt)}</td>
                  <td className="px-4 py-3.5 whitespace-nowrap">{r.status === "missing" ? "—" : `${r.items} 条`}</td>
                  <td className="px-4 py-3.5 whitespace-nowrap">{r.attempts} 次</td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-wrap items-start gap-2">
                      {r.status !== "missing" ? (
                        <a href={`/admin/deliveries/${d.date}/preview?subscriber=${r.subscriber.id}&sent=1`} target="_blank" rel="noreferrer" className="flex min-h-9 items-center rounded-lg border border-line px-3 text-[13px] whitespace-nowrap no-underline">
                          已发出的
                        </a>
                      ) : null}
                      <a href={`/admin/deliveries/${d.date}/preview?subscriber=${r.subscriber.id}`} target="_blank" rel="noreferrer" className="flex min-h-9 items-center rounded-lg border border-line px-3 text-[13px] whitespace-nowrap no-underline">
                        {r.status === "sent" ? "预览重发" : "预览"}
                      </a>
                      {canSend && r.subscriber.status !== "unsubscribed" ? (
                        <ResendButton date={d.date} action="resend" subscriberId={r.subscriber.id} label={r.status === "sent" ? "重新发送" : "发送"} confirmLabel="确认发送" />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-0 text-xs text-muted">
          "重新发送"按这一期现在的全部内容（含之后补采的）和他现在的主题、语言重新挑选，生成一封带个人链接的邮件；"预览重发"打开的就是会发出的内容，"已发出的"是当时发出的那封。
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-base font-bold">发出的推文（{d.list.length}）</h2>
        <ol className="m-0 flex list-none flex-col gap-0 overflow-hidden rounded-[14px] border border-line bg-white p-0">
          {d.list.map((i) => (
            <li key={i.id} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 border-b border-line px-4 py-3.5 last:border-b-0">
              <span className="flex min-w-0 flex-1 basis-[420px] flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  {i.topic ? (
                    <span className="inline-flex items-center gap-1.5 font-bold" style={{ color: i.topic.color }}>
                      <span className="size-1.5 rounded-[2px]" style={{ background: i.topic.color }} />
                      {i.topic.name}
                    </span>
                  ) : null}
                  <a href={i.url} target="_blank" rel="noreferrer" className="font-mono">
                    @{i.handle}
                  </a>
                  <span className="text-muted">{i.quality} 分</span>
                </span>
                <span className="text-[13px] leading-relaxed text-body">{i.summary}</span>
              </span>
              <span className="text-xs whitespace-nowrap text-muted">{i.receivedBy} 人收到</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-base font-bold">发送记录（{d.log.length}）</h2>
        <ol className="m-0 flex list-none flex-col gap-0 overflow-hidden rounded-[14px] border border-line bg-white p-0">
          {d.log.map((l) => (
            <li key={l.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line px-4 py-3 text-[13px] last:border-b-0">
              <span className="font-mono text-xs whitespace-nowrap text-muted">{fmt(l.sentAt)}</span>
              <span className="w-[72px] font-bold">{KIND_LABELS[l.kind]}</span>
              <span className="font-mono">{l.email}</span>
              {l.recipients > 1 ? <span className="text-xs text-muted">合并发送（{l.recipients} 人一封）</span> : null}
              <span className={l.status === "sent" ? "text-[#2F7D4F]" : "text-danger"}>{l.status === "sent" ? `成功 · ${l.tweetIds.length} 条` : `失败：${l.error}`}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
