import { FEEDBACK_REASONS, parseFeedbackParams, REASON_LABELS, tweets, verifyFeedback } from "@xrss/core/db";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Notice } from "@/components/Notice";
import { db } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "反馈 · 精选晨报", robots: { index: false, follow: false } };

type Params = Record<string, string | undefined>;

/**
 * 邮件里 👍 / 👎 打开的确认页。只展示、不记录：邮箱的安全扫描会预先打开链接，
 * 点"确认"（POST /api/feedback）才算数。
 */
export default async function FeedbackPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  if (params.done) {
    return (
      <Notice title="已收到，谢谢" tone="success">
        <p className="m-0">你的反馈会用来调整以后的精选。</p>
      </Notice>
    );
  }

  const req = parseFeedbackParams((k) => params[k]);
  const d = await db();
  const ok = req ? await verifyFeedback(d, req) : null;
  if (!req || !ok) {
    return (
      <Notice title="链接已失效" tone="error">
        <p className="m-0">请从最近一封邮件里重新点击 👍 或 👎。</p>
      </Notice>
    );
  }
  const [tweet] = await d.select({ handle: tweets.handle, raw: tweets.raw }).from(tweets).where(eq(tweets.id, req.tweetId));
  const excerpt = (tweet?.raw.text ?? "").replace(/\s+/g, " ").slice(0, 90);

  return (
    <Notice title="这条内容对你有用吗？">
      <p className="m-0 text-muted">
        @{tweet?.handle}：{excerpt}
        {excerpt.length >= 90 ? "……" : ""}
      </p>
      <form method="post" action="/api/feedback" className="flex flex-col gap-4">
        {(["t", "d", "s", "g"] as const).map((k) => (params[k] ? <input key={k} type="hidden" name={k} value={params[k]} /> : null))}
        <fieldset className="m-0 flex gap-3 border-0 p-0">
          <legend className="sr-only">评价</legend>
          {(
            [
              ["up", "👍 有用"],
              ["down", "👎 不感兴趣"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-line px-4 has-[:checked]:border-ink has-[:checked]:font-bold">
              <input type="radio" name="v" value={value} defaultChecked={req.vote === value} />
              {label}
            </label>
          ))}
        </fieldset>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-sm text-muted">选了 👎 的话，原因是（可不选）：</legend>
          <div className="flex flex-wrap gap-2">
            {FEEDBACK_REASONS.map((r) => (
              <label key={r} className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-sm has-[:checked]:border-ink has-[:checked]:font-bold">
                <input type="radio" name="reason" value={r} />
                {REASON_LABELS[r]}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="h-12 cursor-pointer self-start rounded-[10px] bg-ink px-6 text-[15px] font-bold text-white">
          确认
        </button>
      </form>
    </Notice>
  );
}
